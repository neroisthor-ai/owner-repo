// First-run setup for Crew AI: take an Anthropic API key from the UI, check it works, keep it in .env (never in git).

import Anthropic from "@anthropic-ai/sdk";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { MODELS } from "./llm.ts";

export const keyLooksRight = (k: string) => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k.trim());

/** Sets ANTHROPIC_API_KEY in an env file, replacing an existing line and leaving every other line alone. */
export function saveKey(envPath: string, key: string): void {
  const line = `ANTHROPIC_API_KEY=${key.trim()}`;
  const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/) : [];
  const at = lines.findIndex((l) => /^\s*ANTHROPIC_API_KEY\s*=/.test(l));
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
export async function connectKey(opts: { key: unknown; envPath: string; check?: typeof checkKey; apply: (key: string) => void }): Promise<KeyResult> {
  const key = typeof opts.key === "string" ? opts.key.trim() : "";
  if (!keyLooksRight(key)) return { ok: false, error: "That doesn't look like an Anthropic API key. It starts with sk-ant-." };
  const r = await (opts.check ?? checkKey)(key);
  if (!r.ok) return r;
  saveKey(opts.envPath, key);
  opts.apply(key);
  return { ok: true };
}
