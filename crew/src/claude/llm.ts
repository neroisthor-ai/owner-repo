// One door to Claude for the whole crew.
//
//  - Model per tier (Haiku routes, Sonnet builds, Opus plans and checks), overridable by env.
//  - Stable context (crew rules, SCENE grammar, show bible) goes first in `system`
//    with a cache breakpoint, so every agent call after the first reads it from cache.
//  - Structured outputs (`output_config.format`) constrain every reply to the
//    role's grammar schema.
//  - Server-side refusal fallbacks on the 5.5 models, cost accounting per call.
//
// Swap in any object with the same `call()` shape (see OfflineLLM) to run
// without a network, or pass `client` to inject a mock Anthropic client in tests.

import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Effort, Tier } from "../crew/roles.ts";

export type Task = "route" | "plan" | "propose" | "direct" | "write" | "screen";

export interface LLMCall {
  task: Task;
  role: string;
  tier: Tier;
  /** stable prefix blocks, identical across calls (cached) */
  system: string[];
  /** volatile per-call content */
  prompt: string;
  schema?: Record<string, unknown>;
  effort?: Effort;
  maxTokens?: number;
  /** structured view of the same request, for offline heuristics and logs */
  context?: unknown;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface LLMResult<T = unknown> {
  ok: boolean;
  data: T | null;
  text: string;
  model: string;
  tier: Tier;
  usage: Usage;
  cost: number;
  ms: number;
  error?: string;
}

export interface LLM {
  readonly mode: "claude" | "offline";
  call<T = unknown>(c: LLMCall): Promise<LLMResult<T>>;
}

export const MODELS: Record<Tier, string> = {
  opus: process.env.CREW_MODEL_OPUS ?? "claude-opus-5-5",
  sonnet: process.env.CREW_MODEL_SONNET ?? "claude-sonnet-5-5",
  haiku: process.env.CREW_MODEL_HAIKU ?? "claude-haiku-4-5",
};

/** $ per million tokens: input, output, cache read, cache write (5 min). */
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-sonnet-5-5": [2, 10, 0.2, 2.5],
  "claude-haiku-4-5": [1, 5, 0.1, 1.25],
  "claude-fable-5-1": [10, 50, 0.25, 12.5],
};

export function costOf(model: string, u: Usage): number {
  const p = PRICES[model] ?? PRICES["claude-sonnet-5-5"];
  return (u.input * p[0] + u.output * p[1] + u.cacheRead * p[2] + u.cacheWrite * p[3]) / 1e6;
}

/** True when the Anthropic SDK can find credentials (env vars or an `ant auth login` profile). */
export function hasCredentials(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE
    || existsSync(join(homedir(), ".config", "anthropic")));
}

/** The minimal client surface Crew uses, so tests can inject a fake. */
export interface ClientLike {
  messages: { create(p: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
  beta: { messages: { create(p: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.Messages.BetaMessage> } };
}

const SUPPORTS_FALLBACK = /^claude-(opus-5-5|sonnet-5-5|opus-5|fable-5-1)$/;

export class ClaudeLLM implements LLM {
  readonly mode = "claude" as const;
  private client: ClientLike;
  private fallbacks: boolean;
  constructor(opts: { client?: ClientLike; fallbacks?: boolean } = {}) {
    this.client = opts.client ?? (new Anthropic() as unknown as ClientLike);
    this.fallbacks = opts.fallbacks ?? process.env.CREW_FALLBACKS !== "0";
  }

  async call<T = unknown>(c: LLMCall): Promise<LLMResult<T>> {
    const model = MODELS[c.tier];
    const t0 = Date.now();
    const empty: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const fail = (error: string, usage = empty): LLMResult<T> => ({ ok: false, data: null, text: "", model, tier: c.tier, usage, cost: costOf(model, usage), ms: Date.now() - t0, error });

    const system: Anthropic.TextBlockParam[] = c.system.map((text, i) => (
      i === c.system.length - 1 ? { type: "text", text, cache_control: { type: "ephemeral" } } : { type: "text", text }
    ));
    const output_config: Anthropic.OutputConfig = {};
    if (c.schema) output_config.format = { type: "json_schema", schema: c.schema };
    // Haiku 4.5 does not take `effort`; Opus 5.5 defaults to medium, so set it explicitly.
    if (c.tier !== "haiku") output_config.effort = c.effort ?? "medium"; // Opus and Sonnet always run on medium unless a call says otherwise
    const base = {
      model,
      max_tokens: c.maxTokens ?? 16000,
      system,
      messages: [{ role: "user" as const, content: c.prompt }],
      ...(Object.keys(output_config).length ? { output_config } : {}),
    };

    let msg: Anthropic.Message | Anthropic.Beta.Messages.BetaMessage;
    try {
      msg = this.fallbacks && SUPPORTS_FALLBACK.test(model)
        ? await this.client.beta.messages.create({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
        : await this.client.messages.create(base);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) return fail("authentication failed: set ANTHROPIC_API_KEY or run `ant auth login`");
      if (e instanceof Anthropic.RateLimitError) return fail("rate limited by the API; try again shortly");
      if (e instanceof Anthropic.BadRequestError) return fail(`bad request: ${e.message}`);
      if (e instanceof Anthropic.APIError) return fail(`API error ${e.status ?? ""}: ${e.message}`);
      return fail(`network error: ${(e as Error).message}`);
    }

    const u = msg.usage;
    const usage: Usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
    if (msg.stop_reason === "refusal") return fail("the model declined this request", usage);
    if (msg.stop_reason === "max_tokens") return fail("ran out of output tokens", usage);
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    let data: T | null = null;
    if (c.schema) {
      try { data = JSON.parse(text) as T; } catch { return fail("reply was not valid JSON", usage); }
    }
    return { ok: true, data, text, model: msg.model ?? model, tier: c.tier, usage, cost: costOf(model, usage), ms: Date.now() - t0 };
  }
}
