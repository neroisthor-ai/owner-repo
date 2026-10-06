// The crew on Gemini: three models, one job each.
//   haiku tier -> Flash-Lite, thinking low:  reads notes, ranks, votes, plays the test audience
//   sonnet tier -> Flash, thinking high:     builds and repairs takes, writes shots
//   opus tier -> Pro, thinking high:         plans, debugs, reviews, outlines
// The tier names are the crew's internal job names; nothing here talks to Anthropic.
//
// Every call is logged to .crew/llm-log.jsonl so the eval and tuning have real failures to learn from.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LLM, LLMCall, LLMResult, Usage } from "../claude/llm.ts";
import type { Tier } from "../crew/roles.ts";
import { GeminiClient, type GeminiResponse, type ThinkingLevel } from "./gemini.ts";

export const GEMINI_MODELS: Record<Tier, string> = {
  haiku: process.env.CREW_GEMINI_LITE ?? "gemini-3.5-flash-lite",
  sonnet: process.env.CREW_GEMINI_FLASH ?? "gemini-3.8-flash",
  opus: process.env.CREW_GEMINI_PRO ?? "gemini-3.1-pro-preview",
};
export const GEMINI_THINKING: Record<Tier, ThinkingLevel> = { haiku: "low", sonnet: "high", opus: "high" };
/** High thinking spends output tokens on thoughts, so give room: a cut-off reply is the commonest failure. */
const MIN_OUTPUT: Record<Tier, number> = { haiku: 4000, sonnet: 32000, opus: 32000 };
const MAX_OUTPUT = 65536;

export const hasGeminiKey = () => !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

export class GeminiLLM implements LLM {
  readonly mode = "gemini" as const;
  private client: GeminiClient;
  log: string | null = null;
  constructor(o: { client?: GeminiClient; apiKey?: string; log?: string } = {}) {
    const key = o.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
    this.client = o.client ?? new GeminiClient({ apiKey: key });
    this.log = o.log ?? null;
  }

  modelFor(tier: Tier): string { return GEMINI_MODELS[tier]; }

  async call<T = unknown>(c: LLMCall): Promise<LLMResult<T>> {
    const model = GEMINI_MODELS[c.tier];
    const base = { model, system: c.system.join("\n\n"), schema: c.schema, thinking: GEMINI_THINKING[c.tier], images: c.images };
    let max = Math.min(MAX_OUTPUT, Math.max(c.maxTokens ?? 0, MIN_OUTPUT[c.tier]));
    let r = await this.client.generate({ ...base, prompt: c.prompt, maxOutputTokens: max });
    const all: GeminiResponse[] = [r];
    // cut off: once more with the most room the model allows
    if (!r.ok && r.errorKind === "max_tokens" && max < MAX_OUTPUT) {
      max = MAX_OUTPUT;
      r = await this.client.generate({ ...base, prompt: c.prompt, maxOutputTokens: max });
      all.push(r);
    }
    // wrong shape: once more, quoting exactly what was wrong (cheaper than escalating, and usually enough)
    if (!r.ok && r.errorKind === "format") {
      const errs = r.formatErrors.length ? r.formatErrors.slice(0, 8).map((e) => `- ${e}`).join("\n") : `- ${r.error ?? "the reply was not valid JSON"}`;
      r = await this.client.generate({ ...base, maxOutputTokens: max, prompt: `${c.prompt}\n\nYOUR LAST REPLY COULD NOT BE USED:\n${errs}\nReply again with only the JSON object, fixing exactly those problems.` });
      all.push(r);
    }
    const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const x of all) { usage.input += x.usage.input - x.usage.cached; usage.cacheRead += x.usage.cached; usage.output += x.usage.output + x.usage.thoughts; }
    const ms = all.reduce((a, x) => a + x.ms, 0);
    this.write({ task: c.task, role: c.role, tier: c.tier, model, ok: r.ok, errorKind: r.errorKind, error: r.error, formatErrors: r.formatErrors, coercions: r.coercions.length, attempts: all.reduce((a, x) => a + x.attempts, 0), schemaMode: r.schemaMode, usage, ms });
    // a reply with usable data despite minor format issues is better than nothing for a step that re-checks everything in code
    const data = (r.ok ? r.data : r.errorKind === "format" && r.data && r.formatErrors.length <= 2 ? r.data : null) as T | null;
    if (!r.ok && !data) return { ok: false, data: null, text: r.text, model, tier: c.tier, usage, cost: 0, ms, error: describe(r) };
    return { ok: true, data: c.schema ? data : null, text: r.text, model: r.model || model, tier: c.tier, usage, cost: 0, ms };
  }

  private write(entry: Record<string, unknown>) {
    if (!this.log) return;
    try { mkdirSync(dirname(this.log), { recursive: true }); appendFileSync(this.log, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n"); } catch { /* logging must never break a note */ }
  }
}

function describe(r: GeminiResponse): string {
  switch (r.errorKind) {
    case "auth": return "Gemini refused the API key: check GEMINI_API_KEY";
    case "quota": return "Gemini's daily quota for this model is used up";
    case "rate": return "Gemini is rate limiting; try again shortly";
    case "not_found": return `Gemini has no model "${r.model}": set CREW_GEMINI_LITE / FLASH / PRO to an id from the model list`;
    case "blocked": return `Gemini blocked the reply (${r.finishReason ?? "safety"})`;
    case "max_tokens": return "the reply was cut off even at the largest output size";
    case "timeout": return "Gemini took too long to answer";
    case "format": return `the reply did not match the format: ${r.formatErrors[0] ?? r.error ?? "invalid JSON"}`;
    default: return r.error ?? "Gemini call failed";
  }
}
