// Grammar-constrained output. Each role gets a JSON schema generated from the
// registry and the show bible: verbs, characters, anchors, props, shot types,
// moves and sound names are enums, and a role's schema only contains the line
// kinds it owns. With structured outputs, Claude cannot emit an unknown word or
// a line it isn't allowed to write; the guard then checks what's left (addresses,
// physics, locality).
//
// Schemas depend only on (show, role), never on the note, so the compiled
// grammar is reused across calls.

import type { Node, Show } from "../scene/ast.ts";
import type { PatchOp } from "../scene/patch.ts";
import {
  ALL_SHOT_KINDS, AMBIENCE, ANGLES, BLOCKING_VERBS, CAMERA_MOVES, LIGHT_MOODS, MOVE_SPEEDS, MUSIC_CUES,
  PERFORMANCE_VERBS, SFX, SIDES, SPEECH_VERBS, type RoleId,
} from "../scene/registry.ts";

type Schema = Record<string, unknown>;

const obj = (properties: Record<string, Schema>): Schema => ({
  type: "object", additionalProperties: false, required: Object.keys(properties), properties,
});
const nullable = (s: Schema): Schema => ({ anyOf: [s, { type: "null" }] });
const en = (values: string[]): Schema => ({ type: "string", enum: [...new Set(values)] });
const str = (description?: string): Schema => (description ? { type: "string", description } : { type: "string" });
const numN = (description: string): Schema => ({ anyOf: [{ type: "number", description }, { type: "null" }] });

function vocab(show: Show) {
  const sets = Object.values(show.sets);
  return {
    chars: Object.keys(show.cast),
    anchors: [...new Set(sets.flatMap((s) => Object.keys(s.anchors)))],
    props: [...new Set(sets.flatMap((s) => Object.keys(s.props)))],
  };
}

export function lineSchemas(show: Show, role: RoleId): Record<string, Schema> {
  const v = vocab(show);
  const anyTarget = [...v.anchors, ...v.chars, ...v.props];
  const out: Record<string, Schema> = {};
  const action = (verbs: string[]) => obj({
    kind: { const: "action" },
    with: { type: "boolean", description: "true = starts together with the previous beat" },
    actor: en(v.chars),
    at: nullable(en(v.anchors)),
    verb: en(verbs),
    target: nullable(en(anyTarget)),
    target2: nullable(en([...v.chars, ...v.anchors])),
    number: numN("walk/run speed in m/s"),
    dur: numN("beat length in seconds (~N)"),
  });
  const all = role === "director";
  if (all || role === "blocking") out.blocking = action(Object.keys(BLOCKING_VERBS));
  if (all || role === "animator") out.performance = action(Object.keys(PERFORMANCE_VERBS));
  if (all || role === "writer") {
    out.dialogue = obj({
      kind: { const: "dialogue" }, with: { type: "boolean" }, actor: en(v.chars), verb: en(Object.keys(SPEECH_VERBS)),
      text: str("the spoken words"), to: nullable(en(v.chars)), dur: numN("override length; normally null so speaking pace sets timing"),
    });
  }
  if (all || role === "sound") {
    out.sound = obj({
      kind: { const: "sound" }, with: { type: "boolean" }, verb: en(["sfx", "music", "ambience", "silence"]),
      name: nullable(en([...Object.keys(SFX), ...Object.keys(MUSIC_CUES), ...Object.keys(AMBIENCE)])),
      dur: numN("seconds; required for silence"),
    });
  }
  if (all || role === "dp") {
    out.shot = obj({
      kind: { const: "shot" }, id: str("shot id, e.g. 4G or 4GA for a new shot"), type: en(ALL_SHOT_KINDS),
      subjects: { type: "array", items: en([...v.chars, ...v.props, ...v.anchors]) },
      move: nullable(en(Object.keys(CAMERA_MOVES))), speed: nullable(en(Object.keys(MOVE_SPEEDS))),
      lens: numN("focal length mm"), angle: nullable(en(ANGLES)), side: nullable(en(SIDES)),
    });
    out.light = obj({ kind: { const: "light" }, mood: en(Object.keys(LIGHT_MOODS)) });
  }
  if (all || role === "editor") {
    out.edit = obj({ kind: { const: "edit" }, verb: en(["trim", "hold"]), a: { type: "number", description: "trim: head seconds; hold: seconds" }, b: numN("trim: tail seconds") });
  }
  return out;
}

function opSchema(show: Show, role: RoleId): Schema {
  const lines = Object.values(lineSchemas(show, role));
  const ops = ["replace", "insert", "delete"];
  if (role === "dp" || role === "director") ops.push("insert_shot");
  return obj({
    op: en(ops),
    addr: str("line address from the episode listing, e.g. 1D.2, or a shot id for its header"),
    line: { anyOf: [...lines, { type: "null" }] },
  });
}

export function takesSchema(show: Show, role: RoleId): Schema {
  return obj({
    takes: {
      type: "array",
      description: "2 or 3 alternative takes, smallest change first",
      items: obj({ purpose: str("one sentence: what this take does for the story"), ops: { type: "array", items: opSchema(show, role) } }),
    },
    pushback: nullable(str("if the note would hurt the cut, say why")),
    idea: nullable(str("one idea the director didn't ask for, in one sentence (not applied)")),
  });
}

export const routeSchema = (shotIds: string[]): Schema => obj({
  shots: { type: "array", items: en(shotIds.length ? shotIds : ["none"]), description: "the shots this note is about" },
  roles: { type: "array", items: en(["writer", "blocking", "dp", "animator", "editor", "sound"]), description: "1 role, at most 2" },
  intent: str("the note restated as a concrete goal, one sentence"),
});

export const planSchema = (shotIds: string[]): Schema => obj({
  shots: { type: "array", items: en(shotIds.length ? shotIds : ["none"]), description: "the shots this note is about" },
  roles: { type: "array", items: en(["writer", "blocking", "dp", "animator", "editor", "sound"]), description: "1 role, at most 2" },
  intent: str("the note restated as a concrete goal, one sentence"),
  brief: str("1-3 sentences for the builder: what to do and what to leave alone"),
});

export const directorSchema: Schema = obj({
  message: str("2-4 short sentences to the human director, results first"),
  order: { type: "array", items: { type: "integer" }, description: "take indices, best first" },
  pushback: nullable(str()),
  idea: nullable(str()),
});

export const screeningSchema = (shotIds: string[]): Schema => obj({
  wants: str("in one sentence: what the main character wants"),
  understood: { type: "boolean", description: "would this viewer be able to say what the character wants?" },
  shots: {
    type: "array",
    items: obj({ id: en(shotIds), confusion: { type: "integer", description: "0-3" }, boredom: { type: "integer", description: "0-3" }, note: nullable(str()) }),
  },
});

// ---------------------------------------------------------------- output -> patch ops

export interface RawOp { op: string; addr: string; line: Record<string, unknown> | null }
export interface RawTake { purpose: string; ops: RawOp[] }
export interface RawTakes { takes: RawTake[]; pushback: string | null; idea: string | null }

export function toNode(l: Record<string, unknown>): Node {
  const g = <T>(k: string, d: T) => (l[k] === undefined ? d : (l[k] as T));
  switch (l.kind) {
    case "action":
      return { kind: "action", with: g("with", false), actor: g("actor", ""), at: g("at", null), verb: g("verb", ""), target: g("target", null), target2: g("target2", null), number: g("number", null), dur: g("dur", null) };
    case "dialogue":
      return { kind: "dialogue", with: g("with", false), actor: g("actor", ""), verb: g("verb", "say"), text: g("text", ""), to: g("to", null), dur: g("dur", null) };
    case "sound":
      return { kind: "sound", with: g("with", false), verb: g("verb", "sfx"), name: g("name", null), dur: g("dur", null) };
    case "shot":
      return { kind: "shot", id: g("id", ""), type: g("type", "MS"), subjects: g("subjects", []), move: g("move", null), speed: g("speed", null), lens: g("lens", null), angle: g("angle", null), side: g("side", null) };
    case "light":
      return { kind: "light", mood: g("mood", "day") };
    case "edit":
      return { kind: "edit", verb: g("verb", "trim"), a: g("a", 0), b: g("b", null) };
    default:
      throw new Error(`unknown line kind ${String(l.kind)}`);
  }
}

export function toOps(take: RawTake): PatchOp[] {
  return take.ops.map((o): PatchOp => {
    if (o.op === "delete") return { op: "delete", addr: o.addr };
    if (!o.line) throw new Error(`${o.op} at ${o.addr} needs a line`);
    const node = toNode(o.line);
    if (o.op === "insert_shot") {
      if (node.kind !== "shot") throw new Error("insert_shot needs a shot header");
      return { op: "insert_shot", addr: o.addr, node };
    }
    if (o.op === "insert") return { op: "insert", addr: o.addr, node };
    return { op: "replace", addr: o.addr, node };
  });
}

// ---------------------------------------------------------------- guided crew (weaker models)
// Small schemas only: the patch itself is text that code parses and checks, so the schema never carries the grammar.

export const textTakesSchema: Schema = obj({
  takes: {
    type: "array", minItems: 1, maxItems: 3,
    description: "1 to 3 alternative takes, smallest change first",
    items: obj({
      purpose: str("one sentence: what this take does for the story"),
      patch: str("patch lines in the SCENE patch language, one change per line, separated by newlines"),
    }),
  },
  pushback: nullable(str("if the note would hurt the cut, say why")),
  idea: nullable(str("one idea the director didn't ask for, in one sentence")),
});

export const rankSchema: Schema = obj({
  order: { type: "array", items: { type: "integer" }, description: "candidate numbers, best first" },
  why: str("one sentence on why the first one is best"),
});

export const reviewSchema: Schema = obj({
  order: { type: "array", items: { type: "integer" }, description: "take numbers, best first" },
  fits: { type: "array", items: { type: "boolean" }, description: "one per take in its original numbering (take 1 first, not your ranking): does it do what the note and plan asked?" },
  message: str("2-4 short sentences to the human director, results first"),
  pushback: nullable(str()),
  idea: nullable(str()),
  redo: nullable(str("only if no take fits: exactly what the builder should change, 1-3 sentences")),
});

export const planDetailSchema = (shotIds: string[]): Schema => obj({
  shots: { type: "array", items: en(shotIds.length ? shotIds : ["none"]), description: "the shots this note is about" },
  roles: { type: "array", items: en(["writer", "blocking", "dp", "animator", "editor", "sound"]), description: "1 role, at most 2" },
  intent: str("the note restated as a concrete goal, one sentence"),
  brief: str("1-3 sentences for the builder: what to do"),
  keep: str("what must not change"),
  success: str("how to tell a take did it, one sentence"),
});
