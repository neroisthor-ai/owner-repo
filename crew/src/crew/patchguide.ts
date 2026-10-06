// Role-specific prompt text for models that write patch TEXT: a short syntax guide, the exact
// addressable lines of the target shots, and examples built from those shots and proven by the guard.

import type { ActionLine, BodyNode, Node, Show } from "../scene/ast.ts";
import { parsePatch, ownerOf } from "../scene/patch.ts";
import { printNode, structure } from "../scene/parse.ts";
import {
  AMBIENCE, ANGLES, BLOCKING_VERBS, CAMERA_MOVES, LENSES, LIGHT_MOODS, MOVE_SPEEDS, MUSIC_CUES, PERFORMANCE_VERBS, SFX,
  SHOT_SIZES, SHOT_TYPES, SIDES, SIZE_ORDER, SPEECH_VERBS, type RoleId,
} from "../scene/registry.ts";
import { evaluate, type Workspace } from "./guard.ts";

export interface GuideCtx { ws: Workspace; show: Show; role: RoleId; targets: string[] }

export interface Vocabulary { verbs: string[]; characters: string[]; anchors: string[]; props: string[]; other: Record<string, string[]> }

const mine = (role: RoleId, n: Node) => role === "director" || ownerOf(n) === role || ownerOf(n) === "any";

/** the target shot blocks, in the order asked */
function blocks(c: GuideCtx) {
  const st = structure(c.ws.doc);
  return c.targets.flatMap((id) => st.shots.filter((s) => s.id === id));
}

function chars(c: GuideCtx): string[] {
  const out = new Set<string>();
  for (const b of blocks(c)) {
    for (const s of b.header.subjects) if (c.show.cast[s]) out.add(s);
    for (const l of b.body) {
      const n = l.node;
      if (n.kind === "action" || n.kind === "dialogue") { out.add(n.actor); if (n.kind === "dialogue" && n.to) out.add(n.to); }
    }
    const cs = c.ws.compiled.shots.find((s) => s.id === b.id);
    if (cs) for (const id of c.ws.compiled.presentIn(cs)) out.add(id);
  }
  return [...out].filter((x) => c.show.cast[x]);
}

export function roleVocabulary(c: GuideCtx): Vocabulary {
  const sets = [...new Set(blocks(c).map((b) => b.scene.set))].map((s) => c.show.sets[s]).filter(Boolean);
  const anchors = [...new Set(sets.flatMap((s) => Object.keys(s.anchors)))];
  const props = [...new Set(sets.flatMap((s) => Object.keys(s.props)))];
  const v: Vocabulary = { verbs: [], characters: [], anchors: [], props: [], other: {} };
  switch (c.role) {
    case "blocking": v.verbs = Object.keys(BLOCKING_VERBS); v.characters = chars(c); v.anchors = anchors; v.props = props; break;
    case "animator": v.verbs = Object.keys(PERFORMANCE_VERBS); v.characters = chars(c); v.anchors = anchors; v.props = props; break;
    case "writer": v.verbs = Object.keys(SPEECH_VERBS); v.characters = chars(c); break;
    case "editor": v.verbs = ["trim", "hold"]; break;
    case "sound":
      v.verbs = ["sfx", "music", "ambience", "silence"];
      v.other = { sfx: Object.keys(SFX), music: Object.keys(MUSIC_CUES), ambience: Object.keys(AMBIENCE) };
      break;
    case "dp":
      v.characters = chars(c); v.props = props;
      v.other = {
        sizes: Object.keys(SHOT_SIZES), types: Object.keys(SHOT_TYPES), moves: Object.keys(CAMERA_MOVES), speeds: Object.keys(MOVE_SPEEDS),
        lenses: LENSES.map(String), angles: ANGLES, sides: SIDES, light: Object.keys(LIGHT_MOODS),
      };
      break;
    default:
      v.verbs = [...Object.keys(BLOCKING_VERBS), ...Object.keys(PERFORMANCE_VERBS), ...Object.keys(SPEECH_VERBS)];
      v.characters = chars(c); v.anchors = anchors; v.props = props;
  }
  return v;
}

// ---------------------------------------------------------------- guide

const FORMS: Record<RoleId, { owns: string; syntax: string[]; forms: string }> = {
  blocking: {
    owns: "movement lines",
    syntax: ["[with] actor[@anchor] verb [target] [target2] [speed] [~N]", "  walk/run: target is an anchor or character, optional speed in m/s: kiran walk fridge 1.0", "  open/close/take: a prop. give <prop> <char>. put <prop> [anchor]. stand/kneel/wait: no target"],
    forms: "edit (->), replace (=), insert (+), delete (-)",
  },
  animator: {
    owns: "face, eyeline and gesture lines",
    syntax: ["[with] actor verb [target] [~N]", "  look/glare/wave/point take a character, anchor or prop target; all other verbs take no target"],
    forms: "edit (->), replace (=), insert (+), delete (-)",
  },
  writer: {
    owns: "dialogue lines",
    syntax: ['[with] actor say|whisper|shout "text" [to char] [~N]', '  example: mum say "Get two forks." to kiran'],
    forms: "edit (->), replace (=), insert (+), delete (-)",
  },
  dp: {
    owns: "shot headers and light lines",
    syntax: ["header: <id> <size|type> [subjects] [move[.speed]] [lens mm] [angle a] [side s]", "  OTS/POV/TWO subjects are written a>b; other sizes take one subject or none", "light <mood>   (one light line per shot)", "replace a header with = and write the whole header including its id: 1D = 1D CU kiran lens 85", "new shot: <existing id> ++ <new id> <header>   (new id like 1DA)"],
    forms: "edit (->), replace (=), insert (+) for light, delete (-) for light, add a shot after a shot (++)",
  },
  editor: {
    owns: "trim and hold lines, and dropping a whole shot",
    syntax: ["trim <head> <tail>   seconds cut from the start and the end of the shot", "hold <seconds>   freeze-extend the end of the shot", "drop a shot: <shot id> -"],
    forms: "edit (->), replace (=), insert (+), delete (-)",
  },
  sound: {
    owns: "sound lines",
    syntax: ["[with] sfx <name> [~N]", "[with] music <cue>", "[with] ambience <name>", "[with] silence ~N"],
    forms: "edit (->), replace (=), insert (+), delete (-)",
  },
  director: { owns: "everything", syntax: ["any SCENE line"], forms: "all forms" },
};

const TITLE: Record<RoleId, string> = { director: "Director", writer: "Writer", blocking: "Blocking", dp: "DP", animator: "Animator", editor: "Editor", sound: "Sound" };
export const roleTitle = (r: RoleId): string => TITLE[r];

/** the line kinds a role may write, as a short phrase for "Change only ... lines" */
export const ownsPhrase = (r: RoleId): string => ({
  director: "any", writer: "say/whisper/shout dialogue", blocking: "movement (enter/exit/walk/sit/open/take...)", dp: "shot header and light",
  animator: "face/look/gesture", editor: "trim/hold", sound: "sfx/music/ambience/silence",
} as Record<RoleId, string>)[r];

export function patchGuide(c: GuideCtx): string {
  const f = FORMS[c.role];
  const v = roleVocabulary(c);
  const ids = c.targets.join(" ");
  const L: string[] = [];
  L.push(`PATCH FORMAT (${TITLE[c.role]}). Write plain text, one op per line, nothing else.`);
  L.push(`You may change: ${f.owns}. Ops: ${f.forms}.`);
  L.push("  ADDR ~2 -> ~3          swap tokens inside one line (old tokens must appear exactly once)");
  L.push("  ADDR = <new line>      replace the whole line");
  L.push("  ADDR + <new line>      insert after ADDR (after a shot id = first line of the shot)");
  L.push("  ADDR -                 delete the line");
  L.push("Line syntax:");
  for (const s of f.syntax) L.push("  " + s);
  L.push("  ~N = seconds, e.g. ~2.5");
  const vv: string[] = [];
  if (v.verbs.length && c.role !== "editor") vv.push(`Verbs: ${v.verbs.join(" ")}`);
  if (v.characters.length) vv.push(`Characters: ${v.characters.join(" ")}`);
  if (v.anchors.length) vv.push(`Anchors: ${v.anchors.join(" ")}`);
  if (v.props.length) vv.push(`Props: ${v.props.join(" ")}`);
  for (const [k, list] of Object.entries(v.other)) vv.push(`${k[0].toUpperCase() + k.slice(1)}: ${list.join(" ")}`);
  L.push(...vv);
  L.push("Rules:");
  L.push(`- Only change shots ${ids}. Addresses must come from the listing.`);
  L.push("- One change per line. Keep everything else on the line identical.");
  L.push('- Durations are ~N seconds. Quote dialogue with straight double quotes.');
  L.push("- No markdown, no code fences, no commentary in the patch.");
  L.push("- Use only the words listed above.");
  return L.join("\n");
}

// ---------------------------------------------------------------- listing

export function targetListing(c: GuideCtx): string {
  const out: string[] = [];
  const insertable: string[] = [];
  out.push("Lines marked * are yours to change. Use these addresses exactly.");
  for (const b of blocks(c)) {
    const cs = c.ws.compiled.shots.find((s) => s.id === b.id);
    const cast = chars({ ...c, targets: [b.id] });
    out.push(`shot ${b.id}: set ${b.scene.set}; characters ${cast.join(" ") || "none"}; ${cs ? cs.dur.toFixed(1) : "?"}s`);
    const row = (addr: string, text: string, own: boolean) => out.push(`${own ? "*" : " "}${addr.padEnd(8)}${text}`);
    row(b.id, printNode(b.header).slice(b.id.length).trim(), c.role === "dp" || c.role === "director");
    insertable.push(b.id);
    for (const l of b.body) { row(l.addr, printNode(l.node as BodyNode).trim(), mine(c.role, l.node)); insertable.push(l.addr); }
  }
  out.push(`You may insert after: ${insertable.join(" ")}`);
  if (c.role === "dp") out.push(`You may add a shot after: ${blocks(c).map((b) => b.id).join(" ")}`);
  if (c.role === "editor") out.push(`You may drop a shot: ${blocks(c).map((b) => b.id).join(" ")}`);
  return out.join("\n");
}

// ---------------------------------------------------------------- examples

interface Cand { purpose: string; patch: string; kind: string }

const round1 = (x: number) => Math.round(x * 10) / 10;
const line = (n: Node) => printNode(n).trim();

function candidates(c: GuideCtx): Cand[] {
  const out: Cand[] = [];
  const v = roleVocabulary(c);
  for (const b of blocks(c)) {
    // timing
    for (const l of b.body) {
      const n = l.node;
      if (!mine(c.role, n)) continue;
      if ((n.kind === "action" || n.kind === "dialogue" || n.kind === "sound") && n.dur !== null && n.dur > 0.6) {
        out.push({ kind: "timing", purpose: `Shorten the beat at ${l.addr}.`, patch: `${l.addr} ~${n.dur} -> ~${Math.max(0.3, round1(n.dur * 0.6))}` });
      } else if ((n.kind === "action" && n.verb !== "walk" && n.verb !== "run") || n.kind === "sound" && n.verb === "silence") {
        const t = line(n);
        out.push({ kind: "timing", purpose: `Give ${l.addr} an explicit length.`, patch: `${l.addr} = ${t.replace(/\s~[\d.]+$/, "")} ~1.5` });
      }
      if (n.kind === "edit") {
        out.push({ kind: "timing", purpose: `Change the ${n.verb} at ${l.addr}.`, patch: `${l.addr} ${n.verb} ${n.a} -> ${n.verb} ${round1(n.a + 0.3)}` });
        out.push({ kind: "delete", purpose: `Remove the ${n.verb} at ${l.addr}.`, patch: `${l.addr} -` });
      }
    }
    // swaps
    for (const l of b.body) {
      const n = l.node;
      if (!mine(c.role, n)) continue;
      if (n.kind === "action") {
        const pool = v.verbs.filter((x) => x !== n.verb && c.role !== "director");
        for (const nv of pool) {
          const a: ActionLine = { ...n, verb: nv };
          out.push({ kind: "swap", purpose: `Swap ${n.verb} for ${nv} at ${l.addr}.`, patch: `${l.addr} = ${line(a)}` });
        }
      }
      if (n.kind === "dialogue") out.push({ kind: "swap", purpose: `Make ${l.addr} a whisper.`, patch: `${l.addr} ${n.verb} -> whisper` });
      if (n.kind === "sound" && n.name && n.verb !== "silence") {
        const names = Object.keys(n.verb === "sfx" ? SFX : n.verb === "music" ? MUSIC_CUES : AMBIENCE).filter((x) => x !== n.name && x !== "stop");
        for (const nm of names.slice(0, 4)) out.push({ kind: "swap", purpose: `Swap ${n.name} for ${nm} at ${l.addr}.`, patch: `${l.addr} ${n.name} -> ${nm}` });
      }
      if (n.kind === "light") for (const m of Object.keys(LIGHT_MOODS).filter((x) => x !== n.mood).slice(0, 3)) out.push({ kind: "swap", purpose: `Change the light to ${m}.`, patch: `${l.addr} ${n.mood} -> ${m}` });
    }
    if (c.role === "dp") {
      const h = b.header;
      const i = SIZE_ORDER.indexOf(h.type);
      if (i > 0) out.push({ kind: "swap", purpose: `Go one size tighter on ${b.id}.`, patch: `${b.id} ${h.type} -> ${SIZE_ORDER[i - 1]}` });
      if (i >= 0 && i < SIZE_ORDER.length - 1) out.push({ kind: "swap", purpose: `Go one size wider on ${b.id}.`, patch: `${b.id} ${h.type} -> ${SIZE_ORDER[i + 1]}` });
      if (h.lens !== null) out.push({ kind: "swap", purpose: `Use a longer lens on ${b.id}.`, patch: `${b.id} lens ${h.lens} -> lens ${h.lens < 85 ? 85 : 50}` });
      else out.push({ kind: "swap", purpose: `Set a lens on ${b.id}.`, patch: `${b.id} = ${line({ ...h, lens: 50 })}` });
      if (!h.angle) out.push({ kind: "swap", purpose: `Shoot ${b.id} from a low angle.`, patch: `${b.id} = ${line({ ...h, angle: "low" })}` });
      if (!h.move) out.push({ kind: "swap", purpose: `Add a slow push to ${b.id}.`, patch: `${b.id} = ${line({ ...h, move: "push", speed: "slow" })}` });
      if (!b.body.some((l) => l.node.kind === "light")) out.push({ kind: "insert", purpose: `Add a warm light to ${b.id}.`, patch: `${b.id} + light warm` });
    }
    // inserts
    const who = chars({ ...c, targets: [b.id] })[0];
    const last = b.body[b.body.length - 1];
    const after = last ? last.addr : b.id;
    const ins: Record<string, [string, string] | null> = {
      animator: who ? [`${who} sigh`, "Add a sigh"] : null, blocking: who ? [`${who} wait ~0.5`, "Add a short pause"] : null,
      writer: who ? [`${who} say "Hm."`, "Add a short reply"] : null, sound: ["silence ~0.5", "Add half a second of silence"],
      editor: ["hold 0.5", "Hold the end of the shot half a second longer"], dp: null, director: null,
    };
    const t = ins[c.role];
    if (t && !(c.role === "editor" && b.body.some((l) => l.node.kind === "edit" && l.node.verb === "hold"))) {
      out.push({ kind: "insert", purpose: c.role === "editor" ? `${t[1]}.` : `${t[1]} after ${after}.`, patch: `${after} + ${t[0]}` });
      if (b.body.length > 1) out.push({ kind: "insert", purpose: c.role === "editor" ? `${t[1]}.` : `${t[1]} after ${b.body[0].addr}.`, patch: `${b.body[0].addr} + ${t[0]}` });
    }
    if (c.role === "editor" && !b.body.some((l) => l.node.kind === "edit" && l.node.verb === "trim")) out.push({ kind: "insert", purpose: `Trim 0.4s off the head of ${b.id}.`, patch: `${b.id} + trim 0.4 0` });
    if (c.role === "sound") out.push({ kind: "insert", purpose: `Add a sound after ${after}.`, patch: `${after} + with sfx whoosh` });
    // deletes
    for (const l of b.body) if (mine(c.role, l.node) && l.node.kind !== "edit" && l.node.kind !== "light") out.push({ kind: "delete", purpose: `Cut the line at ${l.addr}.`, patch: `${l.addr} -` });
    if (c.role === "editor") out.push({ kind: "delete", purpose: `Drop shot ${b.id}.`, patch: `${b.id} -` });
    if (c.role === "dp") out.push({ kind: "shot", purpose: `Add a coverage shot after ${b.id}.`, patch: `${b.id} ++ ${b.id}Z ${b.header.type === "WS" ? "MS" : "WS"}` });
  }
  return out;
}

export function examplesFor(c: GuideCtx, n = 3): { purpose: string; patch: string }[] {
  const allowed = new Set(c.targets);
  const picked: { purpose: string; patch: string }[] = [];
  const kinds = new Map<string, number>();
  let tries = 0;
  const cands = candidates(c);
  // one per kind first, then fill
  const order = ["timing", "swap", "insert", "delete", "shot"];
  for (const pass of [1, 2]) {
    for (const k of order) {
      for (const cand of cands) {
        if (picked.length >= n || tries > 60) return picked;
        if (cand.kind !== k || (kinds.get(k) ?? 0) >= pass || picked.some((p) => p.patch === cand.patch)) continue;
        tries++;
        try {
          const ev = evaluate(c.ws, parsePatch(cand.patch), { role: c.role, allowed, requireChange: true });
          if (!ev.ok) continue;
        } catch { continue; }
        picked.push({ purpose: cand.purpose, patch: cand.patch });
        kinds.set(k, (kinds.get(k) ?? 0) + 1);
        break;
      }
    }
  }
  return picked;
}
