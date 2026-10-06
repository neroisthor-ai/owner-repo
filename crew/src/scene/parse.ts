// SCENE parser, validator and canonical serializer.
//
// Episode files are line-oriented: scene lines and shot headers sit at column 0,
// shot body lines are indented. Every line parses to exactly one AST node, and
// every node can be printed back to one line, so Claude's structured output and
// the human's text editor share one representation.

import type {
  ActionLine, BodyNode, Doc, DocLine, Node, SceneLine, ShotHeader, Show, Structure, Style,
  SetDef, ShotBlock,
} from "./ast.ts";
import {
  ACTION_VERBS, ALL_SHOT_KINDS, AMBIENCE, ANGLES, CAMERA_MOVES, COLORS, EDIT_VERBS, FURNITURE, LIGHT_MOODS,
  MOVE_SPEEDS, MUSIC_CUES, PALETTES, RESERVED, SENSORS, SFX, SHOT_TYPES, SIDES, SOUND_VERBS, SPEECH_VERBS,
} from "./registry.ts";
import { parseBlend } from "../voice/engines.ts";
import { furnitureSpec, isFurniture } from "./geometry.ts";
import { PROP_META } from "../../library/props/meta.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Where `include <set>` looks: library/sets/<name>.scene */
export const SETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "library", "sets");
export function librarySets(): string[] {
  return existsSync(SETS_DIR) ? readdirSync(SETS_DIR).filter((f) => f.endsWith(".scene")).map((f) => f.slice(0, -6)).sort() : [];
}
export function librarySetSource(name: string): string | null {
  const f = join(SETS_DIR, `${name}.scene`);
  return /^[a-z][a-z0-9_]*$/.test(name) && existsSync(f) ? readFileSync(f, "utf8") : null;
}

export class SceneError extends Error {}

// ---------------------------------------------------------------- tokens

export function tokenize(src: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) out.push(JSON.stringify(m[1].replace(/\\"/g, '"')));
    else out.push(m[2]);
  }
  return out;
}

const isQuoted = (t: string) => t.startsWith('"') && t.endsWith('"') && t.length >= 2;
const unquote = (t: string) => JSON.parse(t) as string;
const NUM = /^-?\d+(\.\d+)?$/;
const isNum = (t: string | undefined) => t !== undefined && NUM.test(t);
const DUR = /^~(\d+(\.\d+)?)$/;
export const SHOT_ID = /^\d+[A-Z]*$/;
const NAME = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)?$/;

export function fmtNum(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r);
}

// ---------------------------------------------------------------- line parsing

function parseHeader(toks: string[]): ShotHeader {
  const [id, type, ...rest] = toks;
  if (!type) throw new SceneError(`shot ${id} needs a type (${ALL_SHOT_KINDS.join(" ")})`);
  if (!ALL_SHOT_KINDS.includes(type)) throw new SceneError(`unknown shot type "${type}" (use ${ALL_SHOT_KINDS.join(" ")})`);
  const h: ShotHeader = { kind: "shot", id, type, subjects: [], move: null, speed: null, lens: null, angle: null, side: null };
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    const [w, sp] = t.split(".");
    if (t === "lens") { h.lens = num(rest[++i], "lens"); continue; }
    if (t === "angle") { h.angle = word(rest[++i], ANGLES, "angle"); continue; }
    if (t === "side") { h.side = word(rest[++i], SIDES, "side"); continue; }
    if (w in CAMERA_MOVES) {
      h.move = w;
      if (sp !== undefined) h.speed = word(sp, Object.keys(MOVE_SPEEDS), "move speed");
      else if (rest[i + 1] && rest[i + 1] in MOVE_SPEEDS) h.speed = rest[++i];
      continue;
    }
    if (h.subjects.length === 0 && /^[a-z]/.test(t)) {
      h.subjects = t.split(">");
      continue;
    }
    throw new SceneError(`unexpected "${t}" in shot header`);
  }
  return h;
}

function num(t: string | undefined, what: string): number {
  if (!isNum(t)) throw new SceneError(`${what} needs a number`);
  return Number(t);
}

function word(t: string | undefined, allowed: string[], what: string): string {
  if (!t || !allowed.includes(t)) throw new SceneError(`${what} must be one of: ${allowed.join(" ")}`);
  return t;
}

function takeDur(toks: string[]): number | null {
  const last = toks[toks.length - 1];
  const m = last && DUR.exec(last);
  if (m) { toks.pop(); return Number(m[1]); }
  return null;
}

function parseBody(toks: string[]): BodyNode {
  const first = toks[0];
  if (first.startsWith("#")) return { kind: "comment", text: toks.join(" ").replace(/^#\s?/, "") };
  if (first === "light") return { kind: "light", mood: word(toks[1], Object.keys(LIGHT_MOODS), "light") };
  if (first === "trim") {
    return { kind: "edit", verb: "trim", a: num(toks[1], "trim head"), b: toks[2] === undefined ? 0 : num(toks[2], "trim tail") };
  }
  if (first === "hold") return { kind: "edit", verb: "hold", a: num(toks[1], "hold"), b: null };

  let w = false;
  let rest = toks.slice();
  if (rest[0] === "with") { w = true; rest = rest.slice(1); }
  if (rest.length === 0) throw new SceneError("`with` needs a line after it");
  const dur = takeDur(rest);

  const head = rest[0];
  if (head in SOUND_VERBS) {
    if (head === "silence") {
      if (rest.length > 1) throw new SceneError("silence takes only ~N");
      return { kind: "sound", with: w, verb: head, name: null, dur: dur ?? 1 };
    }
    const name = rest[1];
    if (!name) throw new SceneError(`${head} needs a name`);
    if (rest.length > 2) throw new SceneError(`unexpected "${rest[2]}" after ${head} ${name}`);
    return { kind: "sound", with: w, verb: head, name, dur };
  }

  // actor[@anchor] verb ...
  const [actorTok, verb, ...args] = rest;
  const [actor, at] = actorTok.split("@");
  if (!NAME.test(actor)) throw new SceneError(`"${actorTok}" is not a character name`);
  if (!verb) throw new SceneError(`${actor} needs a verb`);

  if (verb in SPEECH_VERBS) {
    const q = args[0];
    if (!q || !isQuoted(q)) throw new SceneError(`${verb} needs a "quoted line"`);
    let to: string | null = null;
    if (args[1] === "to") { to = args[2] ?? null; if (!to) throw new SceneError("`to` needs a character"); }
    else if (args[1] !== undefined) throw new SceneError(`unexpected "${args[1]}" after dialogue`);
    if (args.length > (to ? 3 : 1)) throw new SceneError("unexpected words after dialogue");
    return { kind: "dialogue", with: w, actor, verb, text: unquote(q), to, dur };
  }

  if (!(verb in ACTION_VERBS)) throw new SceneError(`unknown verb "${verb}"`);
  const a: ActionLine = { kind: "action", with: w, actor, at: at ?? null, verb, target: null, target2: null, number: null, dur };
  for (const t of args) {
    if (isNum(t)) { if (a.number !== null) throw new SceneError("only one number allowed"); a.number = Number(t); continue; }
    if (!NAME.test(t)) throw new SceneError(`"${t}" is not a valid name`);
    if (a.target === null) a.target = t;
    else if (a.target2 === null) a.target2 = t;
    else throw new SceneError(`unexpected "${t}"`);
  }
  return a;
}

export function parseLine(text: string, indented: boolean): Node | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return { kind: "comment", text: trimmed.replace(/^#\s?/, "") };
  const toks = tokenize(trimmed);
  if (!indented) {
    if (toks[0] === "episode") {
      return { kind: "episode", n: num(toks[1], "episode"), title: toks[2] && isQuoted(toks[2]) ? unquote(toks[2]) : "" };
    }
    if (toks[0] === "scene") {
      const s: SceneLine = { kind: "scene", n: num(toks[1], "scene"), set: toks[2] ?? "", time: toks[3] ?? "day", act: null };
      if (!s.set) throw new SceneError("scene needs a set");
      if (toks[4] === "act") s.act = num(toks[5], "act");
      else if (toks[4] !== undefined) throw new SceneError(`unexpected "${toks[4]}" in scene line`);
      return s;
    }
    if (SHOT_ID.test(toks[0])) return parseHeader(toks);
    throw new SceneError(`a line at column 0 must be "episode", "scene" or a shot id like 4G (got "${toks[0]}")`);
  }
  return parseBody(toks);
}

export function parseEpisode(src: string): Doc {
  let uid = 0;
  const lines: DocLine[] = src.replace(/\r\n/g, "\n").split("\n").map((text) => {
    const line: DocLine = { uid: uid++, text, node: null };
    try {
      line.node = parseLine(text, /^\s/.test(text));
    } catch (e) {
      line.error = (e as Error).message;
    }
    return line;
  });
  while (lines.length && !lines[lines.length - 1].text.trim()) lines.pop();
  return { lines };
}

// ---------------------------------------------------------------- canonical printing

export function printNode(n: Node): string {
  switch (n.kind) {
    case "episode": return `episode ${n.n}${n.title ? " " + JSON.stringify(n.title) : ""}`;
    case "scene": return `scene ${n.n} ${n.set} ${n.time}${n.act !== null ? ` act ${n.act}` : ""}`;
    case "shot": {
      const p = [n.id, n.type];
      if (n.subjects.length) p.push(n.subjects.join(">"));
      if (n.move) p.push(n.speed ? `${n.move}.${n.speed}` : n.move);
      if (n.lens !== null) p.push(`lens ${fmtNum(n.lens)}`);
      if (n.angle) p.push(`angle ${n.angle}`);
      if (n.side) p.push(`side ${n.side}`);
      return p.join(" ");
    }
    case "comment": return `  # ${n.text}`;
    case "light": return `  light ${n.mood}`;
    case "edit": return n.verb === "trim" ? `  trim ${fmtNum(n.a)} ${fmtNum(n.b ?? 0)}` : `  hold ${fmtNum(n.a)}`;
    case "sound": {
      const p = n.with ? ["with"] : [];
      p.push(n.verb);
      if (n.name) p.push(n.name);
      if (n.dur !== null) p.push(`~${fmtNum(n.dur)}`);
      return "  " + p.join(" ");
    }
    case "dialogue": {
      const p = n.with ? ["with"] : [];
      p.push(n.actor, n.verb, JSON.stringify(n.text));
      if (n.to) p.push("to", n.to);
      if (n.dur !== null) p.push(`~${fmtNum(n.dur)}`);
      return "  " + p.join(" ");
    }
    case "action": {
      const p = n.with ? ["with"] : [];
      p.push(n.at ? `${n.actor}@${n.at}` : n.actor, n.verb);
      if (n.target) p.push(n.target);
      if (n.target2) p.push(n.target2);
      if (n.number !== null) p.push(fmtNum(n.number));
      if (n.dur !== null) p.push(`~${fmtNum(n.dur)}`);
      return "  " + p.join(" ");
    }
  }
}

export function printDoc(doc: Doc): string {
  return doc.lines.map((l) => l.text).join("\n") + "\n";
}

// ---------------------------------------------------------------- structure & addresses

export function structure(doc: Doc): Structure {
  const st: Structure = { episode: null, scenes: [], shots: [], addr: new Map(), addrOf: new Map(), shotOf: new Map() };
  let scene: Structure["scenes"][number] | null = null;
  let shot: ShotBlock | null = null;
  doc.lines.forEach((l, i) => {
    const n = l.node;
    if (!n) return;
    if (n.kind === "episode") { st.episode = n; st.addr.set("episode", i); st.addrOf.set(i, "episode"); return; }
    if (n.kind === "scene") {
      scene = { index: i, node: n, shots: [] };
      st.scenes.push(scene);
      shot = null;
      const a = `scene${n.n}`;
      st.addr.set(a, i); st.addrOf.set(i, a);
      return;
    }
    if (n.kind === "shot") {
      if (!scene) { l.error = l.error ?? "shot before any scene line"; return; }
      shot = { id: n.id, headerIndex: i, header: n, body: [], scene: scene.node, sceneIndex: st.scenes.length - 1 };
      scene.shots.push(shot);
      st.shots.push(shot);
      st.addr.set(n.id, i); st.addrOf.set(i, n.id); st.shotOf.set(i, n.id);
      return;
    }
    if (!shot) { if (n.kind !== "comment") l.error = l.error ?? "body line outside a shot"; return; }
    const a = `${shot.id}.${shot.body.length + 1}`;
    shot.body.push({ index: i, addr: a, node: n });
    st.addr.set(a, i); st.addrOf.set(i, a); st.shotOf.set(i, shot.id);
  });
  return st;
}

// ---------------------------------------------------------------- validation against the show bible

export interface Issue {
  addr: string;
  line: number; // 1-based source line
  message: string;
}

export function validate(doc: Doc, show: Show): Issue[] {
  const st = structure(doc);
  const issues: Issue[] = [];
  const at = (i: number, message: string) => issues.push({ addr: st.addrOf.get(i) ?? `line${i + 1}`, line: i + 1, message });
  doc.lines.forEach((l, i) => { if (l.error) at(i, l.error); });
  const seen = new Set<string>();
  for (const sc of st.scenes) {
    const set = show.sets[sc.node.set];
    if (!set) { at(sc.index, `unknown set "${sc.node.set}" (have: ${Object.keys(show.sets).join(", ")})`); continue; }
    for (const shot of sc.shots) {
      if (seen.has(shot.id)) at(shot.headerIndex, `duplicate shot id ${shot.id}`);
      seen.add(shot.id);
      checkHeader(shot.header, set, show, (m) => at(shot.headerIndex, m));
      let lights = 0;
      for (const b of shot.body) checkBody(b.node, set, show, (m) => at(b.index, m), () => lights++);
      if (lights > 1) at(shot.headerIndex, "only one light line per shot");
      const first = shot.body.find((b) => b.node.kind !== "comment" && b.node.kind !== "light" && b.node.kind !== "edit");
      if (first && "with" in first.node && first.node.with) at(first.index, "the first beat of a shot cannot start with `with`");
    }
  }
  return issues;
}

function checkHeader(h: ShotHeader, set: SetDef, show: Show, err: (m: string) => void) {
  const pair = SHOT_TYPES[h.type];
  if (pair && h.type !== "INSERT") {
    if (h.subjects.length !== 2) err(`${h.type} needs two subjects written a>b`);
  } else if (h.subjects.length > 1) err(`${h.type} takes one subject (or none for the whole room)`);
  for (const s of h.subjects) {
    if (h.type === "INSERT") { if (!set.props[s] && !set.anchors[s]) err(`INSERT subject "${s}" is not a prop or anchor in ${set.id}`); }
    else if (!show.cast[s]) err(`unknown character "${s}"`);
  }
  if (h.type === "INSERT" && h.subjects.length !== 1) err("INSERT needs one prop");
  if (h.lens !== null && (h.lens < 8 || h.lens > 600)) err("lens must be between 8 and 600 mm");
}

function checkBody(n: BodyNode, set: SetDef, show: Show, err: (m: string) => void, light: () => void) {
  const isChar = (x: string) => !!show.cast[x];
  const isAnchor = (x: string) => !!set.anchors[x];
  const isProp = (x: string) => !!set.props[x];
  switch (n.kind) {
    case "comment": return;
    case "light": light(); return;
    case "edit":
      if (n.a < 0 || (n.b ?? 0) < 0) err(`${n.verb} values must be positive`);
      if (!(n.verb in EDIT_VERBS)) err(`unknown edit "${n.verb}"`);
      return;
    case "sound": {
      const vocab = n.verb === "sfx" ? SFX : n.verb === "music" ? MUSIC_CUES : n.verb === "ambience" ? AMBIENCE : null;
      if (vocab && n.name && !(n.name in vocab)) err(`unknown ${n.verb} "${n.name}" (have: ${Object.keys(vocab).join(" ")})`);
      if (n.dur !== null && n.dur <= 0) err("duration must be positive");
      return;
    }
    case "dialogue":
      if (!isChar(n.actor)) err(`unknown character "${n.actor}"`);
      if (n.to && !isChar(n.to)) err(`unknown character "${n.to}"`);
      if (!n.text.trim()) err("empty dialogue");
      return;
    case "action": {
      if (!isChar(n.actor)) err(`unknown character "${n.actor}"`);
      if (n.at && !isAnchor(n.at)) err(`unknown anchor "${n.at}" in set ${set.id} (have: ${Object.keys(set.anchors).join(" ")})`);
      const v = ACTION_VERBS[n.verb];
      const ok = (kind: string, x: string): boolean => {
        switch (kind) {
          case "anchor": return isAnchor(x);
          case "char": return isChar(x);
          case "prop": return isProp(x);
          case "place": return isAnchor(x) || isChar(x);
          case "any": return isAnchor(x) || isChar(x) || isProp(x);
          default: return false;
        }
      };
      if (n.target !== null) {
        if (v.target === "none") err(`${n.verb} takes no target`);
        else if (!ok(v.target, n.target)) err(`"${n.target}" is not a valid ${v.target === "place" ? "anchor or character" : v.target} for ${n.verb}`);
      } else if (v.target === "prop" || (v.target === "any" && n.verb !== "wave")) {
        err(`${n.verb} needs a target`);
      }
      if (n.target2 !== null) {
        if (!v.target2) err(`${n.verb} takes one target`);
        else if (!ok(v.target2, n.target2)) err(`"${n.target2}" is not a valid ${v.target2} for ${n.verb}`);
      } else if (n.verb === "give") err("give needs <prop> <char>");
      if (n.number !== null && !["walk", "run"].includes(n.verb)) err(`${n.verb} takes no number`);
      if (n.number !== null && n.number <= 0) err("speed must be positive");
      if (n.dur !== null && n.dur <= 0) err("duration must be positive");
      if (n.target === n.actor) err(`${n.actor} cannot target themselves`);
      return;
    }
  }
}

// ---------------------------------------------------------------- show bible

const DEFAULT_STYLE: Style = {
  lens: 35, sensor: [36, 24], fps: 24, twos: true, asl: 4, move: "static", speed: "slow", pace: 160,
  side: "left", palette: "warm", pad: 0.35, acts: {},
};

export interface ShowOptions {
  /** where `include <set>` gets a set's source (default: library/sets/<name>.scene) */
  sets?: (name: string) => string | null;
}

export function parseShow(src: string, opts: ShowOptions = {}): Show {
  const show: Show = { title: "Untitled", style: structuredClone(DEFAULT_STYLE), cast: {}, sets: {}, errors: [] };
  let set: SetDef | null = null;
  const getSet = opts.sets ?? librarySetSource;
  /** while reading an included set file: the id to give its `set` line, and its library name */
  let inc: { as: string; name: string } | null = null;
  const lines = (text: string, errAt: (m: string) => void) => {
    const t = text.trim();
    if (!t || t.startsWith("#")) return;
    const err = errAt;
    try {
      const toks = tokenize(t);
      const kv = (from: number) => {
        const m: Record<string, string[]> = {};
        for (let k = from; k < toks.length; ) {
          const key = toks[k++];
          const vals: string[] = [];
          while (k < toks.length && !KEYS.has(toks[k])) vals.push(toks[k++]);
          m[key] = vals;
        }
        return m;
      };
      switch (toks[0]) {
        case "show": show.title = toks[1] && isQuoted(toks[1]) ? unquote(toks[1]) : toks.slice(1).join(" "); return;
        case "style": return applyStyle(show.style, toks.slice(1), err);
        case "cast": {
          const id = toks[1];
          if (!id || !NAME.test(id) || RESERVED.has(id)) return err(`bad character id "${id}"`);
          const m = kv(2);
          const color = m.color?.[0] ?? "slate";
          show.cast[id] = {
            id,
            name: m.name?.[0] ? unquote(m.name[0]) : id,
            height: m.height ? Number(m.height[0]) : 1.7,
            color: COLORS[color] ?? (color.startsWith("#") ? color : COLORS.slate),
            voice: m.voice?.[0] ?? "neutral",
            pace: m.pace ? Number(m.pace[0]) : null,
            tts: m.tts?.[0] ?? null,
            lang: m.lang?.[0] ?? null,
            ttsSpeed: m.speed ? Number(m.speed[0]) : null,
            model: m.model?.[0] ?? (/female|woman/.test(m.voice?.[0] ?? "") ? "female" : /male|man/.test(m.voice?.[0] ?? "") ? "male" : null),
          };
          return;
        }
        case "set": {
          const id = inc ? inc.as : toks[1];
          if (!id || !NAME.test(id)) return err(`bad set id "${id}"`);
          const m = kv(2);
          set = { id, w: m.size ? Number(m.size[0]) : 8, d: m.size ? Number(m.size[1] ?? m.size[0]) : 6, entrance: m.entrance?.[0] ?? "", anchors: {}, props: {}, dress: [] };
          if (inc) set.from = inc.name;
          if ("open" in m) set.open = true;
          show.sets[id] = set;
          return;
        }
        case "include": {
          if (inc) return err("a library set cannot include another set");
          const name = toks[1];
          if (!name) return err("include needs a library set name");
          if (toks[2] !== undefined && (toks[2] !== "as" || !toks[3] || toks.length > 4)) return err("include <set> [as <id>]");
          const body = getSet(name);
          if (body === null) return err(`unknown library set "${name}" (have: ${librarySets().join(", ") || "none"})`);
          const as = toks[3] ?? name;
          if (!NAME.test(as)) return err(`bad set id "${as}"`);
          if (show.sets[as]) return err(`set "${as}" is already defined`);
          inc = { as, name };
          for (const l of body.replace(/\r\n/g, "\n").split("\n")) lines(l, (m) => show.errors.push({ line: 0, message: `library set ${name}: ${m}` }));
          inc = null;
          return;
        }
        case "dress": {
          if (!set) return err("dress outside a set");
          const kind = toks[1];
          if (!kind || !isFurniture(kind)) return err(`unknown prop "${kind}" (any library prop id; crew library search --kind prop)`);
          const m = kv(2);
          if (!m.at || m.at.length < 2) return err("dress needs `at x z`");
          const on = m.on?.[0] ?? null;
          const onFurn = on ? set.anchors[on]?.furniture : null;
          const y = m.height ? Number(m.height[0]) : onFurn ? furnitureSpec(onFurn)?.surface ?? 0 : 0;
          const scale = m.scale ? Number(m.scale[0]) : 1;
          if (!(scale > 0)) return err("scale must be positive");
          const n = set.dress.filter((d) => d.kind === kind).length;
          set.dress.push({ id: n ? `${kind}.${n + 1}` : kind, kind, x: Number(m.at[0]), z: Number(m.at[1]), y, face: m.face ? Number(m.face[0]) : 0, scale, on });
          return;
        }
        case "anchor": {
          if (!set) return err("anchor outside a set");
          const id = toks[1];
          if (!id || !NAME.test(id) || RESERVED.has(id)) return err(`bad anchor id "${id}"`);
          const m = kv(2);
          if (!m.at || m.at.length < 2) return err("anchor needs `at x z`");
          const furn = m.is?.[0] ?? Object.keys(FURNITURE).find((k) => id.includes(k)) ?? (PROP_META[id] ? id : null);
          if (m.is?.[0] && m.is[0] !== "none" && !isFurniture(m.is[0])) return err(`unknown furniture "${m.is[0]}" (a legacy word like chair, or a library prop id)`);
          set.anchors[id] = { id, x: Number(m.at[0]), z: Number(m.at[1]), face: m.face ? Number(m.face[0]) : null, furniture: furn === "none" ? null : furn };
          return;
        }
        case "prop": {
          if (!set) return err("prop outside a set");
          const id = toks[1];
          if (!id || !NAME.test(id)) return err(`bad prop id "${id}"`);
          const m = kv(2);
          if (!m.at || m.at.length < 2) return err("prop needs `at x z`");
          const on = m.on?.[0] ?? null;
          const furn = on ? set.anchors[on]?.furniture : null;
          const y = m.height ? Number(m.height[0]) : furn ? furnitureSpec(furn)?.surface ?? 0.9 : 0;
          const kind = m.is?.[0] ?? (PROP_META[id] ? id : null);
          if (kind && !PROP_META[kind]) return err(`unknown library prop "${kind}"`);
          set.props[id] = { id, x: Number(m.at[0]), z: Number(m.at[1]), y, on, kind };
          return;
        }
        default: err(`unknown show line "${toks[0]}"`);
      }
    } catch (e) {
      err((e as Error).message);
    }
  };
  src.replace(/\r\n/g, "\n").split("\n").forEach((text, i) => lines(text, (m) => show.errors.push({ line: i + 1, message: m })));
  for (const s of Object.values(show.sets)) {
    if (!s.entrance) s.entrance = s.anchors.door ? "door" : Object.keys(s.anchors)[0] ?? "";
    for (const p of Object.values(s.props)) if (p.on && !s.anchors[p.on]) show.errors.push({ line: 0, message: `prop ${p.id} is on unknown anchor ${p.on}` });
    for (const d of s.dress) if (d.on && !s.anchors[d.on]) show.errors.push({ line: 0, message: `dress ${d.id} is on unknown anchor ${d.on}` });
  }
  for (const c of Object.values(show.cast)) {
    if (c.tts && !c.tts.startsWith("preset:")) { try { parseBlend(c.tts); } catch (e) { show.errors.push({ line: 0, message: `cast ${c.id}: ${(e as Error).message}` }); } }
    if (c.lang && c.lang !== "en-us" && c.lang !== "en-gb") show.errors.push({ line: 0, message: `cast ${c.id}: lang must be en-us or en-gb` });
  }
  if (!PALETTES[show.style.palette]) show.errors.push({ line: 0, message: `unknown palette ${show.style.palette}` });
  return show;
}

const KEYS = new Set(["open", "scale", "name", "height", "color", "voice", "pace", "model", "tts", "lang", "speed", "look", "size", "entrance", "at", "face", "on", "is"]);

function applyStyle(s: Style, toks: string[], err: (m: string) => void) {
  if (toks[0] === "act") {
    const n = Number(toks[1]);
    if (toks[2] === "palette" && toks[3] && PALETTES[toks[3]]) s.acts[n] = { ...s.acts[n], palette: toks[3] };
    else err("style act N palette <name>");
    return;
  }
  const [k, v] = toks;
  switch (k) {
    case "lens": s.lens = Number(v); break;
    case "sensor": if (SENSORS[v]) s.sensor = SENSORS[v]; else err(`sensor: ${Object.keys(SENSORS).join(" ")}`); break;
    case "fps": s.fps = Number(v); break;
    case "twos": s.twos = v !== "off"; break;
    case "asl": s.asl = Number(v); break;
    case "move": if (v in CAMERA_MOVES) s.move = v; else err("unknown move"); break;
    case "speed": if (v in MOVE_SPEEDS) s.speed = v; else err("unknown speed"); break;
    case "pace": s.pace = Number(v); break;
    case "side": if (v === "left" || v === "right") s.side = v; else err("side left|right"); break;
    case "palette": if (PALETTES[v]) s.palette = v; else err(`palette: ${Object.keys(PALETTES).join(" ")}`); break;
    case "pad": s.pad = Number(v); break;
    default: err(`unknown style "${k}"`);
  }
}
