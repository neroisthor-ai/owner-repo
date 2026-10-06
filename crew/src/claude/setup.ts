// First-run setup for Crew AI: take an Anthropic or Gemini API key from the UI, check it works, keep it in .env (never in git).

import Anthropic from "@anthropic-ai/sdk";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { MODELS } from "./llm.ts";
import type { GeminiClient } from "../llm/gemini.ts";

export type Provider = "anthropic" | "gemini";
export const ENV_VAR: Record<Provider, string> = { anthropic: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY" };
export const keyLooksRight = (k: string, provider: Provider = "anthropic") =>
  provider === "gemini" ? /^[A-Za-z0-9._-]{30,}$/.test(k.trim()) : /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k.trim());

/** Sets the provider's key in an env file, replacing an existing line and leaving every other line alone. */
export function saveKey(envPath: string, key: string, provider: Provider = "anthropic"): void {
  const name = ENV_VAR[provider];
  const line = `${name}=${key.trim()}`;
  const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/) : [];
  const at = lines.findIndex((l) => new RegExp(`^\\s*${name}\\s*=`).test(l));
  if (at >= 0) lines[at] = line; else { if (lines.length && lines[lines.length - 1] === "") lines.pop(); lines.push(line); }
  writeFileSync(envPath, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
  try { chmodSync(envPath, 0o600); } catch { /* not every filesystem has modes */ }
}

/** One tiny Haiku call: proves the key is accepted without spending anything meaningful. */
export async function checkKey(key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await new Anthropic({ apiKey: key.trim(), maxRetries: 0 }).messages.create({ model: MODELS.haiku, max_tokens: 1, messages: [{ role: "user", content: "hi" }] });
    return { ok: true };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { ok: false, error: "Anthropic refused that key. Check it was copied whole." };
    return { ok: false, error: `Couldn't reach Anthropic to check the key: ${(e as Error).message}` };
  }
}

/** Is this request from the page we serve? Blocks other sites (and DNS tricks) from posting a key. */
export function sameOrigin(host: string | undefined, origin: string | undefined, contentType: string | undefined): boolean {
  if (!host || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return false;
  if (!/^application\/json\b/i.test(contentType ?? "")) return false;
  if (origin && origin !== `http://${host}`) return false;
  return true;
}

export interface KeyResult { ok: boolean; error?: string }

/** The whole flow behind POST /api/key, with the network check injected so it can be tested. */
export async function connectKey(opts: { key: unknown; envPath: string; provider?: Provider; check?: (key: string) => Promise<{ ok: true } | { ok: false; error: string }>; apply: (key: string) => void }): Promise<KeyResult> {
  const provider = opts.provider ?? "anthropic";
  const key = typeof opts.key === "string" ? opts.key.trim() : "";
  if (!keyLooksRight(key, provider)) return { ok: false, error: provider === "gemini" ? "That doesn't look like a Gemini API key. Copy it from Google AI Studio." : "That doesn't look like an Anthropic API key. It starts with sk-ant-." };
  const r = await (opts.check ?? (provider === "gemini" ? checkGeminiKey : checkKey))(key);
  if (!r.ok) return r;
  saveKey(opts.envPath, key, provider);
  opts.apply(key);
  return { ok: true };
}

/**
 * Lists Gemini models with the key: proves the key works, and that the three models the crew uses exist.
 * A wrong or retired model id is the likeliest setup failure (Pro is a preview), so name the missing ones.
 */
export async function checkGeminiKey(key: string, client?: GeminiClient): Promise<{ ok: true } | { ok: false; error: string }> {
  const { GeminiClient: C } = await import("../llm/gemini.ts");
  const { GEMINI_MODELS } = await import("../llm/gemini-llm.ts");
  let ids: string[];
  try { ids = await (client ?? new C({ apiKey: key, maxRetries: 1 })).listModels(); } catch (e) {
    const m = (e as Error).message;
    return { ok: false, error: /401|403|API key|permission/i.test(m) ? "Google refused that key. Check it was copied whole." : `Couldn't reach Gemini to check the key: ${m}` };
  }
  const missing = Object.values(GEMINI_MODELS).filter((id) => !ids.includes(id));
  if (missing.length) return { ok: false, error: `The key works, but these models aren't available to it: ${missing.join(", ")}. Set CREW_GEMINI_LITE / FLASH / PRO in .env to ids it has (for example ${ids.filter((i) => /gemini-3/.test(i)).slice(0, 6).join(", ") || ids.slice(0, 6).join(", ")}).` };
  return { ok: true };
}
