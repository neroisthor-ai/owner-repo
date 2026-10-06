// Schema adapters for Gemini: a lowered JSON Schema for response_json_schema, a complexity
// heuristic (Gemini 400s on big grammars), and a prose rendering for prompt-only mode.
//
// Pure: no I/O. Validation always runs against the original schema, never the lowered one.

import { schemaStats, type Schema } from "./json.ts";

/** Above any of these, skip native structured output and describe the shape in the prompt. */
export const COMPLEXITY_LIMITS = { enumValues: 400, anyOfBranches: 12, bytes: 24000, depth: 8 } as const;

const KEEP = new Set(["type", "description", "enum", "items", "properties", "required", "anyOf", "minItems", "maxItems", "minimum", "maximum"]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function lowerForGemini(schema: Schema): Schema {
  return lower(schema) as Schema;
}

function lower(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(lower);
  if (!isObj(s)) return s;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "properties" && isObj(v)) o.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, lower(pv)]));
    else if (k === "const") { o.enum = [v]; }
    else if (KEEP.has(k)) o[k] = lower(v);
  }
  if ("const" in s) {
    if (o.type === undefined) o.type = "string";
    delete o.anyOf;
  }

  if (Array.isArray(o.enum)) {
    const vals = o.enum as unknown[];
    const hasNull = vals.some((x) => x === null);
    const nonStr = vals.some((x) => typeof x !== "string" && x !== null);
    o.enum = [...new Set(vals.filter((x) => x !== null).map((x) => String(x)))];
    if (nonStr || hasNull) {
      const base = o.type === undefined ? ["string"] : Array.isArray(o.type) ? (o.type as string[]) : [String(o.type)];
      const types = base.map((t) => (t === "null" ? t : "string"));
      if (hasNull && !types.includes("null")) types.push("null");
      o.type = types.length === 1 ? types[0] : [...new Set(types)];
    }
  }

  if (Array.isArray(o.anyOf)) {
    const bs = o.anyOf as Record<string, unknown>[];
    const isNull = (b: unknown) => isObj(b) && b.type === "null" && Object.keys(b).every((k) => k === "type" || k === "description");
    const nulls = bs.filter(isNull);
    const rest = bs.filter((b) => !isNull(b));
    if (bs.length === 2 && nulls.length === 1 && isObj(rest[0]) && typeof rest[0].type === "string" && rest[0].type !== "null" && !rest[0].anyOf) {
      const { anyOf: _drop, ...outer } = o;
      return { ...rest[0], ...outer, type: [rest[0].type, "null"] };
    }
  }
  return o;
}

/** True when Gemini is likely to reject the schema as too complex. */
export function tooComplex(schema: Schema): boolean {
  const st = schemaStats(lowerForGemini(schema));
  const L = COMPLEXITY_LIMITS;
  return st.enumValues > L.enumValues || st.anyOfBranches > L.anyOfBranches || st.bytes > L.bytes || st.depth > L.depth;
}

/** Compact description of a schema's shape. Long repeated enums become named value lists. */
export function schemaAsPromptText(schema: Schema): string {
  const lists = new Map<string, { name: string; vals: string[] }>();
  const enumRef = (vals: unknown[]): string => {
    const strs = vals.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
    if (strs.length <= 6) return strs.map((v) => JSON.stringify(v)).join(" | ");
    const key = strs.join("\u0000");
    let e = lists.get(key);
    if (!e) { e = { name: `L${lists.size + 1}`, vals: strs }; lists.set(key, e); }
    return `one of ${e.name}`;
  };
  const nullable = (t: string[]) => t.filter((x) => x !== "null");

  const render = (s: unknown, ind: string): string => {
    if (!isObj(s)) return "any";
    const desc = typeof s.description === "string" ? s.description : "";
    const note = desc ? ` (${desc})` : "";
    if (Array.isArray(s.anyOf)) {
      const bs = s.anyOf;
      const nul = bs.some((b) => isObj(b) && b.type === "null");
      const rest = bs.filter((b) => !(isObj(b) && b.type === "null"));
      const orNull = nul ? " or null" : "";
      if (rest.length === 1) return render(rest[0], ind) + orNull;
      return `exactly one of${orNull}:\n` + rest.map((b) => `${ind}  - ${render(b, ind + "    ")}`).join("\n");
    }
    if ("const" in s) return JSON.stringify(s.const);
    const types = Array.isArray(s.type) ? s.type.map(String) : s.type ? [String(s.type)] : [];
    const orNull = types.includes("null") && types.length > 1 ? " or null" : "";
    const main = nullable(types)[0] ?? (isObj(s.properties) ? "object" : "any");
    if (Array.isArray(s.enum)) return `${enumRef(s.enum)}${orNull}${note}`;
    if (main === "object" && isObj(s.properties)) {
      const req = new Set(Array.isArray(s.required) ? s.required.map(String) : []);
      const lines = Object.entries(s.properties).map(([k, v]) => `${ind}  "${k}"${req.has(k) ? "" : " (optional)"}: ${render(v, ind + "  ")}`);
      return `{\n${lines.join("\n")}\n${ind}}${orNull}${note}`;
    }
    if (main === "array") {
      const lim = [typeof s.minItems === "number" ? `at least ${s.minItems}` : "", typeof s.maxItems === "number" ? `at most ${s.maxItems}` : ""].filter(Boolean).join(", ");
      return `list of ${render(s.items, ind)}${lim ? ` (${lim})` : ""}${orNull}${note}`;
    }
    const range = [typeof s.minimum === "number" ? `min ${s.minimum}` : "", typeof s.maximum === "number" ? `max ${s.maximum}` : ""].filter(Boolean).join(", ");
    return `${main}${range ? ` (${range})` : ""}${orNull}${note}`;
  };

  const shape = render(schema, "");
  if (!lists.size) return shape;
  const legend = [...lists.values()].map((l) => `${l.name} = ${l.vals.join(" | ")}`).join("\n");
  return `${shape}\n\nValue lists (use these exact spellings):\n${legend}`;
}
