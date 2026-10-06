// The writers' room for weaker models: never ask one model for a whole episode.
//   1. Pro writes an outline: scenes (set, time) and shots (id, type, subjects, what happens), from small enums
//   2. code writes the episode skeleton (episode, scene and shot header lines) from the outline
//   3. Flash writes each shot's body lines, a few shots at a time, with the outline beat and the previous shot for continuity
//   4. code assembles and validates; Flash repairs only the shots with errors (2 rounds), then Pro once
// The result is the same WriteResult the Claude writers' room returns.

import { ALL_SHOT_KINDS } from "../scene/registry.ts";
import { parseEpisode, printDoc } from "../scene/parse.ts";
import type { LLM } from "../claude/llm.ts";
import type { Project } from "../project.ts";
import { workspace } from "./guard.ts";
import { stableSystem } from "./prompts.ts";
import type { CrewEvent } from "./direct.ts";
import type { WriteResult } from "./writers.ts";

type Schema = Record<string, unknown>;
const obj = (properties: Record<string, Schema>): Schema => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const en = (v: string[]): Schema => ({ type: "string", enum: [...new Set(v)] });

interface OutlineShot { id: string; type: string; subjects: string[]; beat: string }
interface Outline { title: string; scenes: { set: string; time: string; shots: OutlineShot[] }[] }

const outlineSchema = (sets: string[], cast: string[]): Schema => obj({
  title: { type: "string" },
  scenes: {
    type: "array", minItems: 1,
    items: obj({
      set: en(sets), time: en(["day", "night", "dawn", "dusk"]),
      shots: {
        type: "array", minItems: 1,
        items: obj({ id: { type: "string", description: "scene number + letter: 1A, 1B, ... 2A" }, type: en(ALL_SHOT_KINDS), subjects: { type: "array", items: en(cast) }, beat: { type: "string", description: "what happens in this shot, including any dialogue word for word" } }),
      },
    }),
  },
});
const linesSchema: Schema = obj({ shots: { type: "array", items: obj({ id: { type: "string" }, lines: { type: "array", items: { type: "string" } } }) } });

const BODY_RULES = `Body lines, one beat per line, written exactly like the reference:
  <actor>@<anchor> <verb> ...   pin where the actor is on their first beat
  <actor> <verb> [target] [~seconds]
  with <line>                  starts together with the previous line
  <actor> say "Words." [to <actor>]   (whisper / shout the same way; straight double quotes)
  sfx <name> / music <cue> / ambience <name> / silence ~N
  light <mood>
Only verbs, sound names, anchors and props from the reference and the show bible. No shot header lines, no indentation, no numbering, no commentary.`;

export async function writeEpisodeGuided(p: Project, script: string, llm: LLM, emit: (e: CrewEvent) => void = () => {}): Promise<WriteResult> {
  const system = stableSystem(p.showSrc);
  const sets = Object.keys(p.show.sets), cast = Object.keys(p.show.cast);
  let cost = 0, attempts = 0;
  const step = async <T>(tier: "opus" | "sonnet", task: "outline" | "shot", prompt: string, schema: Schema, label: string) => {
    emit({ kind: "call", role: "writer", tier, message: label });
    attempts++;
    const r = await llm.call<T>({ task, role: "writer", tier, system, prompt, schema, maxTokens: 16000 });
    cost += r.cost;
    if (!r.ok) emit({ kind: "error", role: "writer", tier, message: `${label} failed: ${r.error}` });
    return r;
  };

  // 1. outline (Pro)
  const o = await step<Outline>("opus", "outline", `Break this script into an episode outline for this show.\n- One scene per location/time change; set and time from the lists.\n- Shot ids are scene number + letter (1A, 1B, ...), in order. Cover dialogue the way a good editor would cut it: establish, then singles or OTS on the speaker or the listener whose reaction matters.\n- "beat" says what happens in the shot in one or two sentences, with any dialogue word for word.\n- Use only this show's cast and sets.\n\nSCRIPT:\n${script.trim()}`, outlineSchema(sets, cast), "writers' room: outline (director)");
  if (!o.ok || !o.data?.scenes?.length) return { ok: false, text: "", errors: [], cost, attempts, error: o.error ?? "no outline" };
  const outline = tidyOutline(o.data, sets, cast);

  // 2. skeleton
  const shots = outline.scenes.flatMap((s, si) => s.shots.map((sh) => ({ ...sh, scene: si + 1, set: s.set })));
  const body = new Map<string, string[]>();

  // 3. bodies (Flash), four shots per call, each call sees the shot before for continuity
  const ask = async (batch: typeof shots, extra = "") => {
    const prompt = `${BODY_RULES}\n\nSCRIPT:\n${script.trim()}\n\nTHE OUTLINE:\n${shots.map((s) => `${s.id} ${s.type} ${s.subjects.join(" ")} (scene ${s.scene}, ${s.set}): ${s.beat}`).join("\n")}\n\nWrite the body lines for these shots only: ${batch.map((s) => s.id).join(", ")}.${batch.map((s) => { const prev = shots[shots.indexOf(s) - 1]; return prev && body.has(prev.id) ? `\nThe shot before ${s.id} (${prev.id}) ends with: ${body.get(prev.id)!.slice(-2).join(" / ")}` : ""; }).join("")}${extra}`;
    const r = await step<{ shots: { id: string; lines: string[] }[] }>("sonnet", "shot", prompt, linesSchema, `writers' room: shots ${batch[0].id}-${batch[batch.length - 1].id}`);
    for (const s of r.data?.shots ?? []) if (batch.some((b) => b.id === s.id)) body.set(s.id, (s.lines ?? []).map(cleanLine).filter(Boolean));
  };
  for (let i = 0; i < shots.length; i += 4) await ask(shots.slice(i, i + 4));

  // 4. assemble, validate, repair only what is broken
  let text = assemble(outline, body);
  let errs = check(p, text);
  for (let round = 0; round < 3 && errs.size; round++) {
    const bad = shots.filter((s) => errs.has(s.id) || !body.get(s.id)?.length);
    if (!bad.length) break;
    const tier = round < 2 ? "sonnet" : "opus";
    emit({ kind: "step", role: "writer", message: `repairing ${bad.length} shot(s)${tier === "opus" ? " (director)" : ""}` });
    const fix = `\n\nTHESE SHOTS HAD ERRORS. Rewrite all their lines:\n${bad.map((s) => `${s.id}:\n${(body.get(s.id) ?? []).map((l, k) => `  ${k + 1}. ${l}`).join("\n") || "  (no lines)"}\n  problems: ${(errs.get(s.id) ?? ["no lines"]).join("; ")}`).join("\n")}`;
    if (tier === "opus") {
      const r = await step<{ shots: { id: string; lines: string[] }[] }>("opus", "shot", `${BODY_RULES}\n\nSCRIPT:\n${script.trim()}${fix}`, linesSchema, "writers' room: director fixing shots");
      for (const s of r.data?.shots ?? []) if (bad.some((b) => b.id === s.id)) body.set(s.id, (s.lines ?? []).map(cleanLine).filter(Boolean));
    } else for (let i = 0; i < bad.length; i += 4) await ask(bad.slice(i, i + 4), fix);
    text = assemble(outline, body);
    errs = check(p, text);
  }
  const errors = [...errs].flatMap(([id, e]) => e.map((x) => `${id}: ${x}`));
  emit({ kind: "filter", role: "writer", message: `draft: ${shots.length} shots, ${errors.length} grammar errors` });
  if (errors.length) return { ok: false, text, errors, cost, attempts, error: "draft still has grammar errors after repairs" };
  return { ok: true, text: printDoc(parseEpisode(text)), errors, cost, attempts };
}

/** Drop unknown sets/cast, renumber shot ids to scene + letter so headers always parse. */
function tidyOutline(o: Outline, sets: string[], cast: string[]): Outline {
  return {
    title: (o.title ?? "Untitled").replace(/"/g, "'").slice(0, 60),
    scenes: o.scenes.filter((s) => s.shots?.length).map((s, si) => ({
      set: sets.includes(s.set) ? s.set : sets[0],
      time: ["day", "night", "dawn", "dusk"].includes(s.time) ? s.time : "day",
      shots: s.shots.map((sh, k) => ({ id: `${si + 1}${String.fromCharCode(65 + (k % 26))}${k >= 26 ? "A" : ""}`, type: ALL_SHOT_KINDS.includes(sh.type) ? sh.type : "MS", subjects: (sh.subjects ?? []).filter((c) => cast.includes(c)), beat: sh.beat ?? "" })),
    })),
  };
}

function cleanLine(l: string): string {
  return String(l ?? "").replace(/```[a-z]*/gi, "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/^\s*(\d+[.)]|[-*•])\s+/, "").trim();
}

function assemble(o: Outline, body: Map<string, string[]>): string {
  const out = [`episode 1 "${o.title}"`, ""];
  o.scenes.forEach((s, si) => {
    out.push(`scene ${si + 1} ${s.set} ${s.time}`);
    for (const sh of s.shots) {
      out.push(`${sh.id} ${sh.type}${sh.subjects.length ? " " + sh.subjects.join(" ") : ""}`);
      for (const l of body.get(sh.id) ?? []) out.push(`  ${l}`);
    }
    out.push("");
  });
  return out.join("\n");
}

/** Grammar errors grouped by shot id. Lines that don't parse carry no address, so map them to a shot by line number. */
function check(p: Project, text: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  const shotAt: string[] = [];
  let cur = "*";
  text.split("\n").forEach((l, i) => { const h = l.match(/^(\d+[A-Z]+)\s/); if (h) cur = h[1]; else if (/^(scene|episode)\b/.test(l)) cur = "*"; shotAt[i + 1] = cur; });
  let ws;
  try { ws = workspace(p.show, parseEpisode(text)); } catch (e) { m.set("*", [(e as Error).message]); return m; }
  for (const g of ws.grammar) {
    const fromAddr = /^\d+[A-Z]+/.exec(String(g.addr ?? ""))?.[0];
    const id = fromAddr ?? shotAt[g.line] ?? "*";
    m.set(id, [...(m.get(id) ?? []), g.message]);
  }
  return m;
}
