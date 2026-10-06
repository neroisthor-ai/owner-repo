// Synthetic test screening: Haiku persona viewers watch the cut (as a timed
// transcript) and report, shot by shot, where they were confused or bored, and
// whether they could say what the character wants. That last number is a kill
// gate in week 1.

import type { BodyNode } from "../scene/ast.ts";
import type { LLM } from "../claude/llm.ts";
import type { Project } from "../project.ts";
import { structure, printNode } from "../scene/parse.ts";
import { fmtTime, stableSystem } from "./prompts.ts";
import { screeningSchema } from "./schema.ts";
import type { CrewEvent } from "./direct.ts";
import type { ScreenCtx } from "./context.ts";

export const PERSONAS = [
  "a 15-year-old watching on a phone with the sound on, quick to swipe away",
  "a parent half-watching while cooking dinner",
  "a film student who notices every cut",
  "a long-time fan of the creator's podcast",
  "a viewer whose first language isn't English, watching with captions",
];

export interface ScreeningResult {
  viewers: { persona: string; wants: string; understood: boolean }[];
  shots: { id: string; confusion: number; boredom: number; notes: string[] }[];
  understoodShare: number;
  cost: number;
  mode: "claude" | "gemini" | "offline";
}

export async function screen(p: Project, llm: LLM, n = PERSONAS.length, emit: (e: CrewEvent) => void = () => {}): Promise<ScreeningResult> {
  const c = p.ws.compiled;
  const st = structure(p.ws.doc);
  const ids = c.shots.map((s) => s.id);
  const transcript = c.shots.map((s) => {
    const b = st.shots.find((x) => x.id === s.id)!;
    const beats = b.body.filter((l) => l.node.kind !== "comment" && l.node.kind !== "edit").map((l) => `    ${printNode(l.node as BodyNode).trim()}`);
    return `${fmtTime(s.cutStart)}  [${s.id}] ${s.label} (${s.cutDur.toFixed(1)}s)\n${beats.join("\n")}`;
  }).join("\n");
  const ctxShots: ScreenCtx["shots"] = c.shots.map((s) => {
    const b = st.shots.find((x) => x.id === s.id)!;
    const nodes = b.body.map((l) => l.node);
    return {
      id: s.id, cutDur: s.cutDur,
      lines: nodes.filter((x) => x.kind === "dialogue").length,
      words: nodes.reduce((a, x) => a + (x.kind === "dialogue" ? x.text.split(/\s+/).length : 0), 0),
      moves: nodes.filter((x) => x.kind === "action" && ["walk", "run", "enter", "exit", "sit", "stand"].includes(x.verb)).length,
      reactions: nodes.filter((x) => x.kind === "action" && !["walk", "run", "enter", "exit"].includes(x.verb)).length,
    };
  });
  const personas = PERSONAS.slice(0, n);
  emit({ kind: "call", role: "audience", tier: "haiku", message: `test screening with ${personas.length} viewers` });
  const results = await Promise.all(personas.map((persona) => llm.call<{ wants: string; understood: boolean; shots: { id: string; confusion: number; boredom: number; note: string | null }[] }>({
    task: "screen", role: "audience", tier: "haiku", system: stableSystem(p.showSrc), schema: screeningSchema(ids), maxTokens: 4000,
    prompt: `You are a test-screening viewer: ${persona}.\nYou are watching this animated short as it plays (timestamps, shot, what you see and hear). Stay in character: react as that viewer would, not as a critic.\n\n${transcript}\n\nFor every shot rate confusion (0 = clear, 3 = lost) and boredom (0 = gripped, 3 = reaching for the remote), with a short note only where something matters. Then say in one sentence what the main character wants, and whether you could actually tell.`,
    context: { persona, shots: ctxShots } satisfies ScreenCtx,
  })));
  const cost = results.reduce((a, r) => a + r.cost, 0);
  const ok = results.filter((r) => r.ok && r.data);
  const viewers = ok.map((r, i) => ({ persona: personas[i], wants: r.data!.wants, understood: !!r.data!.understood }));
  const shots = ids.map((id) => {
    const rows = ok.flatMap((r) => r.data!.shots.filter((s) => s.id === id));
    const avg = (k: "confusion" | "boredom") => rows.length ? rows.reduce((a, s) => a + Math.max(0, Math.min(3, s[k])), 0) / rows.length : 0;
    return { id, confusion: Math.round(avg("confusion") * 100) / 100, boredom: Math.round(avg("boredom") * 100) / 100, notes: rows.map((s) => s.note).filter((x): x is string => !!x) };
  });
  emit({ kind: "done", role: "audience", message: `${viewers.filter((v) => v.understood).length}/${viewers.length} viewers could say what the character wants`, cost });
  return { viewers, shots, understoodShare: viewers.length ? viewers.filter((v) => v.understood).length / viewers.length : 0, cost, mode: llm.mode };
}
