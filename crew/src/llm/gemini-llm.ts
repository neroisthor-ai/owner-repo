// The crew on Gemini: three models, one job each.
//   haiku tier -> Flash-Lite, thinking low:  reads notes, ranks, votes, plays the test audience
//   sonnet tier -> Flash, thinking high:     builds and repairs takes, writes shots
//   opus tier -> Pro, thinking high:         plans, debugs, reviews, outlines
//     or, when Pro isn't on the key's tier (free tier), a Flash group: several Flash calls on high thinking with
//     the most output room, run side by side, then one more Flash call that checks them against each other and
//     writes the final answer (CREW_PRO_MODE, CREW_FLASH_GROUP)
// Each tier has a ladder of models (CREW_GEMINI_FLASH_LADDER, CREW_GEMINI_LITE_LADDER). Free quota is set per model,
// so when one runs out (or is overloaded) the call steps down to the next, and a model out of quota is skipped until
// Google says it resets.
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
const listOf = (v: string | undefined, d: string[]) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : d);
const withTop = (top: string, l: string[]) => [top, ...l.filter((m) => m !== top)];
/** The models each tier tries, best first. */
export const GEMINI_LADDERS: Record<Tier, string[]> = {
  haiku: withTop(GEMINI_MODELS.haiku, listOf(process.env.CREW_GEMINI_LITE_LADDER, ["gemini-3.1-flash-lite"])),
  sonnet: withTop(GEMINI_MODELS.sonnet, listOf(process.env.CREW_GEMINI_FLASH_LADDER, ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"])),
  opus: [GEMINI_MODELS.opus],
};
export const GEMINI_THINKING: Record<Tier, ThinkingLevel> = { haiku: "low", sonnet: "high", opus: "high" };
/** High thinking spends output tokens on thoughts, so give room: a cut-off reply is the commonest failure. */
const MIN_OUTPUT: Record<Tier, number> = { haiku: 4000, sonnet: 32000, opus: 32000 };
const MAX_OUTPUT = 65536;

export const hasGeminiKey = () => !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

/** Who does Pro's jobs. "pro": Gemini Pro. "flash": the Flash group. "auto": Pro, switching to the Flash group for
 *  the rest of the run the first time Google says Pro is out of quota or not on this key's tier. */
export type ProMode = "auto" | "pro" | "flash";
export const PRO_MODE: ProMode = (["auto", "pro", "flash"] as const).find((m) => m === process.env.CREW_PRO_MODE) ?? "auto";
/** How many Flash calls answer each of Pro's jobs before the final pass (2 to 6). */
export const FLASH_GROUP = Math.max(2, Math.min(6, Math.round(Number(process.env.CREW_FLASH_GROUP ?? 3)) || 3));

type Once<T> = { res: LLMResult<T>; kind?: GeminiResponse["errorKind"]; raw?: string };
/** How long to skip a model after each kind of failure, when Google doesn't say. */
const REST_MS: Partial<Record<NonNullable<GeminiResponse["errorKind"]>, number>> = { quota: 6 * 3600e3, rate: 120e3, server: 60e3, not_found: 24 * 3600e3 };
/** "Please retry in 5h8m34.08s" -> ms */
export function retryInMs(text: string): number | undefined {
  const m = /retry in\s+(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)s)?/i.exec(text);
  if (!m || !(m[1] || m[2] || m[3])) return undefined;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000;
}

export class GeminiLLM implements LLM {
  readonly mode = "gemini" as const;
  private client: GeminiClient;
  log: string | null = null;
  readonly proMode: ProMode;
  readonly groupSize: number;
  /** true once Pro's jobs go to the Flash group */
  standIn: boolean;
  readonly ladders: Record<Tier, string[]>;
  /** model -> time (ms) until which it is skipped */
  readonly resting = new Map<string, number>();
  private now: () => number;
  constructor(o: { client?: GeminiClient; apiKey?: string; log?: string; proMode?: ProMode; groupSize?: number; ladders?: Partial<Record<Tier, string[]>>; now?: () => number } = {}) {
    const key = o.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
    this.client = o.client ?? new GeminiClient({ apiKey: key });
    this.log = o.log ?? null;
    this.proMode = o.proMode ?? PRO_MODE;
    this.groupSize = o.groupSize ?? FLASH_GROUP;
    this.standIn = this.proMode === "flash";
    this.ladders = { ...GEMINI_LADDERS, ...o.ladders };
    this.now = o.now ?? Date.now;
  }

  /** The tier's models that aren't resting, best first (all of them if every one is resting: one may have reset). */
  ladder(tier: Tier): string[] {
    const all = this.ladders[tier], up = all.filter((m) => (this.resting.get(m) ?? 0) <= this.now());
    return up.length ? up : all;
  }

  /** Try the tier's models in turn: out of quota, rate limited, overloaded or missing steps down to the next. */
  private async climb<T>(c: LLMCall, tier: Tier): Promise<Once<T>> {
    const rungs = this.ladder(tier);
    let last!: Once<T>;
    for (const [i, model] of rungs.entries()) {
      last = await this.once<T>(c, model);
      const rest = last.kind && REST_MS[last.kind];
      if (last.res.ok || !rest) return last;
      const ms = (last.kind === "quota" || last.kind === "rate" ? retryInMs(last.raw ?? "") : undefined) ?? rest;
      this.resting.set(model, this.now() + ms);
      const next = rungs[i + 1];
      this.write({ task: c.task, role: c.role, tier: c.tier, note: `${model}: ${last.kind}, resting ${Math.round(ms / 60000)} min${next ? `; stepping down to ${next}` : "; no model left on this ladder"}` });
    }
    return last;
  }

  /** The model doing a tier's job (the grips in capability.ts are looked up by this). */
  modelFor(tier: Tier): string { return this.ladder(tier === "opus" && this.standIn ? "sonnet" : tier)[0]; }

  async call<T = unknown>(c: LLMCall): Promise<LLMResult<T>> {
    if (c.tier === "opus" && this.standIn) return this.group<T>(c);
    const r = await this.climb<T>(c, c.tier);
    if (c.tier === "opus" && this.proMode === "auto" && !r.res.ok && r.kind === "quota") {
      this.standIn = true;
      this.write({ task: c.task, role: c.role, tier: c.tier, note: `Pro unavailable (${r.res.error}); the Flash group of ${this.groupSize} does Pro's jobs from now on` });
      return this.group<T>(c);
    }
    return r.res;
  }

  /** Pro's job done by several Flash calls side by side, then a Flash pass that checks them and writes the answer. */
  private async group<T>(c: LLMCall): Promise<LLMResult<T>> {
    const flash = this.modelFor("sonnet"), wide = { ...c, maxTokens: MAX_OUTPUT };
    const takes = await Promise.all(Array.from({ length: this.groupSize }, (_, i) => this.climb<T>({ ...wide, role: `${c.role}#${i + 1}` }, "sonnet")));
    const usage = sumUsage(takes.map((t) => t.res.usage));
    let ms = Math.max(...takes.map((t) => t.res.ms));
    const good = takes.filter((t) => t.res.ok).map((t) => t.res);
    const done = (r: LLMResult<T>): LLMResult<T> => ({ ...r, tier: "opus", model: `${flash} x${this.groupSize}`, usage, ms });
    if (!good.length) return done(takes[0].res);
    const shown = (r: LLMResult<T>) => (c.schema ? JSON.stringify(r.data, null, 1) : r.text.trim());
    if (good.length === 1 || good.every((r) => shown(r) === shown(good[0]))) return done(good[0]);
    const answers = good.map((r, i) => `--- ANSWER ${i + 1} ---\n${shown(r)}`).join("\n\n");
    const prompt = `${c.prompt}\n\n${good.length} colleagues each answered the task above on their own. Their answers:\n\n${answers}\n\n--- END OF ANSWERS ---\n` +
      "Now write the final answer to the task above. Check every answer against the task: where they disagree, work out which is right " +
      "(the majority can be wrong); keep what is correct, drop what is wrong, and fix anything all of them missed. " +
      "Don't mention the colleagues or their answers. Reply in exactly the format the task asks for.";
    const final = await this.climb<T>({ ...wide, role: `${c.role}#final`, prompt }, "sonnet");
    const all = sumUsage([usage, final.res.usage]);
    ms += final.res.ms;
    const r = final.res.ok ? final.res : good[0];
    return { ...r, tier: "opus", model: `${flash} x${this.groupSize}`, usage: all, ms };
  }

  private async once<T>(c: LLMCall, model: string): Promise<Once<T>> {
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
    if (!r.ok && !data) return { kind: r.errorKind, raw: r.error, res: { ok: false, data: null, text: r.text, model, tier: c.tier, usage, cost: 0, ms, error: describe(r) } };
    return { res: { ok: true, data: c.schema ? data : null, text: r.text, model: r.model || model, tier: c.tier, usage, cost: 0, ms } };
  }

  private write(entry: Record<string, unknown>) {
    if (!this.log) return;
    try { mkdirSync(dirname(this.log), { recursive: true }); appendFileSync(this.log, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n"); } catch { /* logging must never break a note */ }
  }
}

const sumUsage = (us: Usage[]): Usage => us.reduce((a, u) => ({ input: a.input + u.input, output: a.output + u.output, cacheRead: a.cacheRead + u.cacheRead, cacheWrite: a.cacheWrite + u.cacheWrite }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

function describe(r: GeminiResponse): string {
  switch (r.errorKind) {
    case "auth": return "Gemini refused the API key: check GEMINI_API_KEY";
    case "quota": return /limit 0/.test(r.error ?? "") ? `${r.model} isn't available on this key's tier (Pro needs billing switched on); set CREW_PRO_MODE=flash` : "Gemini's daily quota for this model is used up";
    case "rate": return "Gemini is rate limiting; try again shortly";
    case "not_found": return `Gemini has no model "${r.model}": set CREW_GEMINI_LITE / FLASH / PRO to an id from the model list`;
    case "blocked": return `Gemini blocked the reply (${r.finishReason ?? "safety"})`;
    case "max_tokens": return "the reply was cut off even at the largest output size";
    case "timeout": return "Gemini took too long to answer";
    case "format": return `the reply did not match the format: ${r.formatErrors[0] ?? r.error ?? "invalid JSON"}`;
    default: return r.error ?? "Gemini call failed";
  }
}
