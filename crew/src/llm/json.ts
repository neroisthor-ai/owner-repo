// Forgiving JSON extraction and schema coercion for models that follow formats loosely.
//
//  - extractJson pulls the first complete object/array out of a reply (fences, prose, trailing
//    commas, smart quotes, NaN, truncation) and says what it had to fix.
//  - validateAndCoerce checks a value against the JSON Schema subset in src/crew/schema.ts,
//    quietly fixing what is safe to fix (recorded as coercions) and reporting the rest with paths.
//
// Pure: no I/O.

export type Schema = Record<string, unknown>;

export interface Coercion { path: string; from: unknown; to: unknown; why: string }

type Extracted = { ok: true; value: unknown; repaired: string[] } | { ok: false; error: string };

// ---------------------------------------------------------------- extraction

class Cut extends Error {}
class Bad extends Error { constructor(m: string, readonly pos: number) { super(m); } }

const WS = " \t\r\n";
const DQ = new Set(['"', "“", "”"]);
const SQ = new Set(["'", "‘", "’"]);

/** End index (exclusive) of the balanced object/array starting at `start`, or -1 when it never closes. */
function balancedEnd(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { if (--depth === 0) return i + 1; }
  }
  return -1;
}

/** Lenient recursive-descent parser. Throws Cut at end of input, Bad on garbage. */
function lenient(s: string, start: number, rep: Set<string>): { value: unknown; end: number } {
  const n = s.length;
  let i = start;

  const skipWs = () => {
    for (;;) {
      while (i < n && WS.includes(s[i])) i++;
      if (s[i] === "/" && s[i + 1] === "/") { rep.add("removed comments"); while (i < n && s[i] !== "\n") i++; }
      else if (s[i] === "/" && s[i + 1] === "*") {
        rep.add("removed comments");
        const e = s.indexOf("*/", i + 2);
        if (e < 0) throw new Cut();
        i = e + 2;
      } else return;
    }
  };

  /** A quote closes a string only when followed by structure (or a newline then another key/item). */
  const closes = (at: number): boolean => {
    let j = at + 1;
    let nl = false;
    while (j < n && WS.includes(s[j])) { if (s[j] === "\n") nl = true; j++; }
    if (j >= n) return true;
    if (",:}]".includes(s[j])) return true;
    return nl && (DQ.has(s[j]) || s[j] === '"');
  };

  const str = (): string => {
    const q = s[i];
    const closers = DQ.has(q) ? DQ : SQ;
    if (q !== '"' && q !== "'") rep.add("smart quotes");
    else if (q === "'") rep.add("single-quoted string");
    i++;
    let out = "";
    for (;;) {
      if (i >= n) throw new Cut();
      const c = s[i];
      if (c === "\\") {
        const x = s[i + 1];
        if (x === undefined) throw new Cut();
        const simple: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", "/": "/", "\\": "\\", '"': '"' };
        if (x === "u" && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) { out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)); i += 6; continue; }
        if (x in simple) out += simple[x];
        else { out += x; rep.add("fixed invalid escape"); }
        i += 2;
        continue;
      }
      if (closers.has(c)) {
        if (closes(i)) {
          if (c !== '"' && c !== "'") rep.add("smart quotes");
          i++;
          return out;
        }
        out += c;
        rep.add("unescaped quote inside a string");
        i++;
        continue;
      }
      if (c === "\n" || c === "\r") rep.add("raw newline inside a string");
      out += c;
      i++;
    }
  };

  const key = (): string => {
    const c = s[i];
    if (DQ.has(c) || SQ.has(c)) return str();
    const m = /^[A-Za-z_$][\w$-]*/.exec(s.slice(i, i + 200));
    if (!m) throw new Bad(`unexpected ${JSON.stringify(c)} where a key was expected`, i);
    rep.add("unquoted key");
    i += m[0].length;
    return m[0];
  };

  const value = (): unknown => {
    skipWs();
    if (i >= n) throw new Cut();
    const c = s[i];
    if (c === "{") return object();
    if (c === "[") return array();
    if (DQ.has(c) || SQ.has(c)) return str();
    const rest = s.slice(i, i + 40);
    const num = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(rest);
    if (num) {
      i += num[0].length;
      if (/^[+.]/.test(num[0]) || num[0].endsWith(".")) rep.add("normalized number");
      return Number(num[0]);
    }
    const word = /^[+-]?[A-Za-z_]+/.exec(rest);
    if (word) {
      const w = word[0];
      const l = w.replace(/^[+-]/, "").toLowerCase();
      if (l === "true" || l === "false") { i += w.length; if (w !== l) rep.add("fixed literal case"); return l === "true"; }
      if (l === "null" || l === "none") { i += w.length; if (w !== "null") rep.add("fixed literal case"); return null; }
      if (l === "nan" || l === "undefined" || l === "infinity") { i += w.length; rep.add("NaN/undefined replaced with null"); return null; }
    }
    if (",}]".includes(c)) { rep.add("filled a missing value with null"); return null; }
    throw new Bad(`unexpected ${JSON.stringify(c)}`, i);
  };

  const after = (close: string) => {
    skipWs();
    if (i >= n) throw new Cut();
    if (s[i] === ",") {
      i++;
      skipWs();
      if (s[i] === close) rep.add("removed trailing comma");
    } else if (s[i] !== close) rep.add("added missing comma");
  };

  const object = (): unknown => {
    i++;
    const o: Record<string, unknown> = {};
    for (;;) {
      skipWs();
      if (i >= n) throw new Cut();
      if (s[i] === "}") { i++; return o; }
      if (s[i] === ",") { i++; rep.add("removed stray comma"); continue; }
      const k = key();
      skipWs();
      if (s[i] === ":" || s[i] === "=") i++;
      else if (i >= n) throw new Cut();
      else rep.add("added missing colon");
      Object.defineProperty(o, k, { value: value(), enumerable: true, writable: true, configurable: true });
      after("}");
    }
  };

  const array = (): unknown => {
    i++;
    const a: unknown[] = [];
    for (;;) {
      skipWs();
      if (i >= n) throw new Cut();
      if (s[i] === "]") { i++; return a; }
      if (s[i] === ",") { i++; rep.add("removed stray comma"); continue; }
      a.push(value());
      after("]");
    }
  };

  const v = value();
  return { value: v, end: i };
}

export function extractJson(text: string): Extracted {
  let s = String(text ?? "");
  const rep = new Set<string>();
  if (s.charCodeAt(0) === 0xfeff) { s = s.slice(1); rep.add("removed BOM"); }
  if (!s.trim()) return { ok: false, error: "the reply was empty" };

  let firstErr: Error | null = null;
  let tries = 0;
  for (let start = s.search(/[{[]/); start >= 0 && tries < 20; start = nextStart(s, start + 1), tries++) {
    const local = new Set(rep);
    try {
      let value: unknown;
      let end: number;
      const be = balancedEnd(s, start);
      let fast = false;
      if (be > 0) {
        try { value = JSON.parse(s.slice(start, be)); end = be; fast = true; } catch { /* fall through */ }
      }
      if (!fast) { const r = lenient(s, start, local); value = r.value; end = r.end; }
      const before = s.slice(0, start).replace(/```[a-zA-Z0-9_-]*/g, "").trim();
      const afterTxt = s.slice(end!).replace(/```/g, "").trim();
      if (/```/.test(s)) local.add("removed markdown code fence");
      if (before || afterTxt) local.add("ignored text around the JSON");
      return { ok: true, value, repaired: [...local] };
    } catch (e) {
      if (e instanceof Cut) { firstErr ??= e; break; } // later starts would be fragments of the cut-off value
      if (e instanceof Bad) {
        firstErr ??= e;
        if (e.pos - start > 40) break;
        continue;
      }
      throw e;
    }
  }
  if (firstErr instanceof Cut) return { ok: false, error: "the reply was cut off before the JSON was complete (a brace or bracket never closed)" };
  if (firstErr) return { ok: false, error: `could not parse the JSON: ${firstErr.message}` };
  return { ok: false, error: "no JSON object or array found in the reply" };
}

function nextStart(s: string, from: number): number {
  const m = s.slice(from).search(/[{[]/);
  return m < 0 ? -1 : from + m;
}

// ---------------------------------------------------------------- validation and coercion

interface R { value: unknown; errors: string[]; coercions: Coercion[] }

const ok = (value: unknown, coercions: Coercion[] = []): R => ({ value, errors: [], coercions });
const bad = (value: unknown, ...errors: string[]): R => ({ value, errors, coercions: [] });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const asSchema = (v: unknown): Schema | null => (isObj(v) ? v : null);
const show = (v: unknown): string => {
  let t: string;
  try { t = JSON.stringify(v) ?? String(v); } catch { t = String(v); }
  return t.length > 60 ? t.slice(0, 57) + "..." : t;
};
const at = (path: string, k: string | number) => (typeof k === "number" ? `${path}[${k}]` : path ? `${path}.${k}` : k);
const label = (path: string) => path || "(root)";
const normWord = (s: string) => s.trim().toLowerCase().replace(/[_\-\s]+/g, " ");

function typesOf(s: Schema): string[] {
  if (Array.isArray(s.type)) return s.type.map(String);
  if (typeof s.type === "string") return [s.type];
  if (s.properties || s.required) return ["object"];
  if (s.items) return ["array"];
  return [];
}

function allowsNull(s: Schema): boolean {
  if (typesOf(s).includes("null")) return true;
  if (Array.isArray(s.anyOf)) return s.anyOf.some((b) => { const bs = asSchema(b); return !!bs && allowsNull(bs); });
  return false;
}

function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

const jsonType = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const same = (a: unknown, b: unknown) => a === b || (typeof a === "object" && a !== null && JSON.stringify(a) === JSON.stringify(b));
const NUM = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function listAllowed(vals: unknown[]): string {
  const shown = vals.slice(0, 25).map((v) => (typeof v === "string" ? v : show(v)));
  return shown.join(", ") + (vals.length > 25 ? `, and ${vals.length - 25} more` : "");
}

function enumCheck(vals: unknown[], v: unknown, path: string): R {
  if (vals.some((x) => same(x, v))) return ok(v);
  const co = (to: unknown, why: string): R => ok(to, [{ path: path || "$", from: v, to, why }]);
  const cands = vals.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") {
    const nv = normWord(v);
    const exact = cands.filter((c) => normWord(c) === nv);
    if (exact.length === 1) return co(exact[0], "matched an allowed value ignoring case and spacing");
    if (exact.length === 0) {
      const lim = nv.length <= 3 ? 1 : 2;
      const scored = cands.map((c) => ({ c, d: lev(nv, normWord(c)) })).filter((x) => x.d <= lim).sort((a, b) => a.d - b.d);
      if (scored.length && (scored.length === 1 || scored[0].d < scored[1].d)) return co(scored[0].c, "closest allowed value");
    }
    const asNum = vals.find((x) => typeof x === "number" && NUM.test(v.trim()) && Number(v) === x);
    if (asNum !== undefined) return co(asNum, "numeric string matched an allowed number");
  } else if (typeof v === "number" || typeof v === "boolean") {
    const m = vals.find((x) => typeof x === "string" && x === String(v));
    if (m !== undefined) return co(m, "matched an allowed value by text");
  }
  return bad(v, `${label(path)}: ${show(v)} is not allowed; allowed: ${listAllowed(vals)}`);
}

function typed(types: string[], s: Schema, v: unknown, path: string): R {
  const p = path || "$";
  const exactType = (t: string) => t === jsonType(v) || (t === "number" && typeof v === "number") || (t === "integer" && typeof v === "number" && Number.isInteger(v));
  const exact = types.find(exactType);
  if (exact) return exact === "object" ? object(s, v as Record<string, unknown>, path) : exact === "array" ? array(s, v as unknown[], path) : ok(v);

  // coercions, in schema order; first that validates wins
  const tries: R[] = [];
  for (const t of types) {
    const co = (to: unknown, why: string): R => ok(to, [{ path: p, from: v, to, why }]);
    if ((t === "number" || t === "integer") && typeof v === "string" && NUM.test(v.trim())) {
      const num = Number(v);
      if (t === "number" || Number.isInteger(num)) { tries.push(co(num, "numeric string")); continue; }
    }
    if (t === "integer" && typeof v === "number" && Math.abs(v - Math.round(v)) < 1e-9) { tries.push(co(Math.round(v), "float with no fraction")); continue; }
    if (t === "boolean" && typeof v === "string" && /^(true|false)$/i.test(v.trim())) { tries.push(co(v.trim().toLowerCase() === "true", "boolean given as text")); continue; }
    if (t === "string" && (typeof v === "number" || typeof v === "boolean")) { tries.push(co(String(v), "text expected")); continue; }
    if (t === "null" && typeof v === "string" && /^(null|none)$/i.test(v.trim())) { tries.push(co(null, "text for null")); continue; }
    if (t === "array" && v !== null && v !== undefined && !Array.isArray(v)) {
      const r = array(s, [v], path);
      if (!r.errors.length) { tries.push({ value: r.value, errors: [], coercions: [{ path: p, from: v, to: r.value, why: "single item where a list was expected" }, ...r.coercions] }); continue; }
    }
  }
  const good = tries.find((r) => !r.errors.length);
  if (good) return good;
  return bad(v, `${label(path)}: expected ${types.join(" or ")}, got ${v === null ? "null" : Array.isArray(v) ? "a list" : typeof v === "string" ? show(v) : jsonType(v)}`);
}

function array(s: Schema, v: unknown[], path: string): R {
  const items = asSchema(s.items);
  if (!items) return ok(v);
  const out: unknown[] = [];
  const errors: string[] = [];
  const coercions: Coercion[] = [];
  v.forEach((x, i) => {
    const r = node(items, x, at(path, i));
    out.push(r.value);
    errors.push(...r.errors);
    coercions.push(...r.coercions);
  });
  return { value: out, errors, coercions };
}

function object(s: Schema, v: Record<string, unknown>, path: string): R {
  const props = asSchema(s.properties) ?? {};
  const required = Array.isArray(s.required) ? s.required.map(String) : [];
  const out: Record<string, unknown> = {};
  const errors: string[] = [];
  const coercions: Coercion[] = [];
  const src: Record<string, unknown> = { ...v };

  // keys that differ only by case/underscore/hyphen from an absent property
  for (const k of Object.keys(src)) {
    if (k in props) continue;
    const m = Object.keys(props).filter((p) => !(p in src) && normWord(p) === normWord(k));
    if (m.length === 1) {
      src[m[0]] = src[k];
      delete src[k];
      coercions.push({ path: at(path, k), from: k, to: m[0], why: "property name matched ignoring case and spacing" });
    }
  }

  for (const k of Object.keys(src)) {
    const ps = asSchema(props[k]);
    if (ps) {
      if (src[k] === undefined) continue;
      const r = node(ps, src[k], at(path, k));
      out[k] = r.value;
      errors.push(...r.errors);
      coercions.push(...r.coercions);
    } else if (s.additionalProperties === false) {
      coercions.push({ path: at(path, k), from: src[k], to: undefined, why: "extra property not in the schema, dropped" });
    } else {
      const ap = asSchema(s.additionalProperties);
      if (ap) {
        const r = node(ap, src[k], at(path, k));
        out[k] = r.value;
        errors.push(...r.errors);
        coercions.push(...r.coercions);
      } else out[k] = src[k];
    }
  }
  for (const k of required) {
    if (k in out && out[k] !== undefined) continue;
    const ps = asSchema(props[k]);
    if (ps && allowsNull(ps)) {
      out[k] = null;
      coercions.push({ path: at(path, k), from: undefined, to: null, why: "missing nullable field" });
    } else errors.push(`${label(at(path, k))}: required property is missing`);
  }
  return { value: out, errors, coercions };
}

function anyOf(branches: Schema[], s: Schema, v: unknown, path: string): R {
  const kind = isObj(v) && typeof v.kind === "string" ? v.kind : undefined;
  const kindOf = (b: Schema) => asSchema(asSchema(b.properties)?.kind)?.const;
  let pool = branches;
  if (kind !== undefined) {
    const m = branches.filter((b) => kindOf(b) === kind);
    if (m.length) pool = m;
    else if (branches.some((b) => kindOf(b) !== undefined)) {
      const kinds = branches.map(kindOf).filter((k) => k !== undefined);
      return bad(v, `${label(at(path, "kind"))}: ${show(kind)} is not allowed; allowed: ${listAllowed(kinds)}`);
    }
  }
  const results = pool.map((b) => node(b, v, path));
  const strict = results.find((r) => !r.errors.length && !r.coercions.length);
  if (strict) return strict;
  if (typeof v === "string" && /^(null|none)$/i.test(v.trim())) {
    const nb = pool.find((b) => typesOf(b).includes("null"));
    if (nb) return ok(null, [{ path: path || "$", from: v, to: null, why: "text for null" }]);
  }
  const clean = results.find((r) => !r.errors.length);
  if (clean) return clean;
  const best = results.reduce((a, b) => (b.errors.length < a.errors.length ? b : a));
  if (pool.length > 1 && !isObj(v) && !Array.isArray(v)) {
    const descr = pool.map((b) => (b.enum ? "one of the allowed values" : typesOf(b).join("/") || "a value"));
    if (results.every((r) => r.errors.length)) {
      // scalar against mixed branches: prefer the enum branch's message, which lists the choices
      const withEnum = results.find((r, i) => pool[i].enum && r.errors.length);
      if (withEnum) return withEnum;
      return bad(v, `${label(path)}: ${show(v)} does not match any of: ${[...new Set(descr)].join(", ")}`);
    }
  }
  return best;
}

function node(s: Schema, v: unknown, path: string): R {
  if (Array.isArray(s.anyOf)) {
    const bs = s.anyOf.map(asSchema).filter((b): b is Schema => !!b);
    if (bs.length) return anyOf(bs, s, v, path);
  }
  if ("const" in s) {
    if (same(s.const, v)) return ok(v);
    if (typeof s.const === "string" && typeof v === "string" && normWord(v) === normWord(s.const)) {
      return ok(s.const, [{ path: path || "$", from: v, to: s.const, why: "matched an allowed value ignoring case and spacing" }]);
    }
    return bad(v, `${label(path)}: ${show(v)} is not allowed; allowed: ${listAllowed([s.const])}`);
  }
  const types = typesOf(s);
  const vals = Array.isArray(s.enum) ? s.enum : null;
  if (v === null && types.includes("null")) return ok(null);
  if (types.length) {
    const r = typed(types, s, v, path);
    if (r.errors.length || !vals || r.value === null) return r;
    const e = enumCheck(vals, r.value, path);
    return { value: e.value, errors: e.errors, coercions: [...r.coercions, ...e.coercions] };
  }
  if (vals) return enumCheck(vals, v, path);
  return ok(v);
}

export function validateAndCoerce(schema: Schema, value: unknown): { value: unknown; errors: string[]; coercions: Coercion[] } {
  return node(schema, value, "");
}

// ---------------------------------------------------------------- stats

export function schemaStats(schema: Schema): { enumValues: number; properties: number; depth: number; anyOfBranches: number; bytes: number } {
  const st = { enumValues: 0, properties: 0, depth: 0, anyOfBranches: 0, bytes: 0 };
  const walk = (s: unknown, d: number) => {
    const sc = asSchema(s);
    if (!sc) return;
    const types = typesOf(sc);
    const container = types.includes("object") || types.includes("array");
    const depth = container ? d + 1 : d;
    if (depth > st.depth) st.depth = depth;
    if (Array.isArray(sc.enum)) st.enumValues += sc.enum.length;
    else if ("const" in sc) st.enumValues += 1;
    if (Array.isArray(sc.anyOf)) { st.anyOfBranches += sc.anyOf.length; sc.anyOf.forEach((b) => walk(b, depth)); }
    const props = asSchema(sc.properties);
    if (props) { st.properties += Object.keys(props).length; Object.values(props).forEach((p) => walk(p, depth)); }
    walk(sc.items, depth);
  };
  walk(schema, 0);
  st.bytes = JSON.stringify(schema).length;
  return st;
}
