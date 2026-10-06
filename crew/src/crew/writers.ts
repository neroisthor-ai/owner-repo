// Writers' room: a pasted script becomes a SCENE episode. Sonnet drafts and
// repairs; if the validator still rejects it, Opus debugs it. It writes SCENE text directly (cheaper than JSON for a whole
// episode); the validator then feeds any errors back for a repair pass.

import { parseEpisode, printDoc } from "../scene/parse.ts";
import type { LLM } from "../claude/llm.ts";
import type { Project } from "../project.ts";
import { workspace } from "./guard.ts";
import { stableSystem } from "./prompts.ts";
import type { CrewEvent } from "./direct.ts";

export interface WriteResult {
  ok: boolean;
  text: string;
  errors: string[];
  cost: number;
  attempts: number;
  error?: string;
}

const INSTRUCTIONS = `Turn the script below into a SCENE episode for this show.
- Use only the cast, sets, anchors and props in the show bible. If the script needs something missing, stage around it and leave a "# needs: ..." comment line in the shot.
- Shot ids are scene number + letter (1A, 1B, ...). Cover dialogue the way a good editor would cut it: establish, then singles/OTS on the speaker or the listener whose reaction matters.
- Block real movement with anchors; pin characters with actor@anchor on their first beat. Let speaking pace set dialogue timing (no ~N on dialogue).
- Don't repeat Style Bible defaults (lens, move) unless a shot needs something different.
- Output only the SCENE episode text, starting with the episode line. No code fences, no commentary.`;

export async function writeEpisode(p: Project, script: string, llm: LLM, emit: (e: CrewEvent) => void = () => {}): Promise<WriteResult> {
  const system = stableSystem(p.showSrc);
  let prompt = `${INSTRUCTIONS}\n\nSCRIPT:\n${script.trim()}`;
  let cost = 0;
  let text = "";
  let errors: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const tier = attempt < 3 ? "sonnet" : "opus"; // the last pass is Opus debugging what Sonnet could not fix
    emit({ kind: "call", role: "writer", tier, message: attempt === 1 ? "writers' room: drafting the episode" : `writers' room: repair pass ${attempt - 1}${tier === "opus" ? " (director)" : ""}` });
    const r = await llm.call({ task: "write", role: "writer", tier, system, prompt, effort: "medium", maxTokens: 16000, context: { script } });
    cost += r.cost;
    if (!r.ok) return { ok: false, text, errors, cost, attempts: attempt, error: r.error };
    text = r.text.replace(/^```\w*\n?|```\s*$/g, "").trim() + "\n";
    const ws = workspace(p.show, parseEpisode(text));
    errors = ws.grammar.map((g) => `${g.addr} (line ${g.line}): ${g.message}`);
    emit({ kind: "filter", role: "writer", message: `draft ${attempt}: ${ws.compiled.shots.length} shots, ${errors.length} grammar errors` });
    if (!errors.length) return { ok: true, text: printDoc(ws.doc), errors, cost, attempts: attempt };
    prompt = `${INSTRUCTIONS}\n\nSCRIPT:\n${script.trim()}\n\nYOUR PREVIOUS DRAFT:\n${text}\n\nTHE VALIDATOR REJECTED THESE LINES:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nReturn the full corrected episode.`;
  }
  return { ok: false, text, errors, cost, attempts: 3, error: "draft still has grammar errors after 2 repair passes" };
}
