// REST client for the Gemini API (v1beta generateContent), built for models that follow
// formats loosely.
//
//  - Thinking level via thinkingConfig (never temperature or thinkingBudget on Gemini 3).
//  - Native structured output when the schema is small enough, else the shape goes in the
//    prompt; a schema-ish 400 falls back to prompt mode once, a mime-type 400 to plain text.
//  - Replies are run through extractJson and checked against the ORIGINAL schema; safe fixes are
//    reported as coercions, the rest as formatErrors, so the caller can ask for a repair.
//  - Retries with backoff on 429/5xx/network/timeout, honouring RetryInfo. Auth, quota, not-found
//    and blocked replies are final and say why.
//
// `fetch`, `sleep` and `now` are injectable so tests run without a network.

import { extractJson, validateAndCoerce, type Coercion, type Schema } from "./json.ts";
import { lowerForGemini, schemaAsPromptText, tooComplex } from "./schema-lower.ts";

export type { Schema, Coercion };
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface GeminiRequest {
  model: string;
  system: string;
  prompt: string;
  /** images sent as inlineData parts before the text */
  images?: { mimeType: string; data: string }[];
  schema?: Schema;
  thinking: ThinkingLevel;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export type GeminiErrorKind = "auth" | "rate" | "quota" | "server" | "timeout" | "blocked" | "max_tokens" | "bad_request" | "not_found" | "empty" | "network" | "format";

export interface GeminiResponse {
  ok: boolean;
  text: string;
  data: unknown | null;
  formatErrors: string[];
  coercions: Coercion[];
  usage: { input: number; output: number; thoughts: number; cached: number };
  model: string;
  ms: number;
  attempts: number;
  schemaMode: "native" | "prompt" | "none";
  finishReason?: string;
  error?: string;
  errorKind?: GeminiErrorKind;
}

export interface GeminiOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const LEVELS: ThinkingLevel[] = ["minimal", "low", "medium", "high"];
const BLOCKED = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "LANGUAGE"]);

interface Raw { status: number; json: any; text: string; retryAfterMs?: number; fail?: "timeout" | "network"; failMsg?: string }

export class GeminiClient {
  private apiKey: string;
  private baseUrl: string;
  private f: typeof fetch;
  private maxRetries: number;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  /** which thinkingLevel casing the API accepted last, remembered per client */
  private upper = true;
  /** lowest thinking level a model accepted after a "not supported" 400 */
  private floor = new Map<string, ThinkingLevel>();

  constructor(o: GeminiOptions) {
    this.apiKey = o.apiKey;
    this.baseUrl = (o.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
    this.f = o.fetch ?? fetch;
    this.maxRetries = o.maxRetries ?? 4;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
  }

  private async send(url: string, init: { method: string; body?: string }, timeoutMs: number): Promise<Raw> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await this.f(url, {
        method: init.method,
        headers: { "x-goog-api-key": this.apiKey, "content-type": "application/json" },
        body: init.body,
        signal: ctl.signal,
      });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* non-JSON body */ }
      const ra = Number(res.headers?.get?.("retry-after"));
      return { status: res.status, json, text, retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined };
    } catch (e) {
      const err = e as Error;
      if (ctl.signal.aborted || err?.name === "AbortError" || err?.name === "TimeoutError") return { status: 0, json: null, text: "", fail: "timeout", failMsg: `no reply within ${Math.round(timeoutMs / 1000)}s` };
      return { status: 0, json: null, text: "", fail: "network", failMsg: err?.message ?? String(e) };
    } finally {
      clearTimeout(timer);
    }
  }

  private backoff(n: number): number {
    return Math.min(60000, 2000 * 2 ** n * (0.75 + Math.random() * 0.5));
  }

  async generate(r: GeminiRequest): Promise<GeminiResponse> {
    const t0 = this.now();
    const usage = { input: 0, output: 0, thoughts: 0, cached: 0 };
    const coercions: Coercion[] = [];
    const lowered = r.schema ? lowerForGemini(r.schema) : undefined;
    let mode: "native" | "prompt" | "none" = r.schema ? (tooComplex(r.schema) ? "prompt" : "native") : "none";
    let level = r.thinking;
    const floor = this.floor.get(r.model);
    if (floor && LEVELS.indexOf(floor) > LEVELS.indexOf(level)) {
      coercions.push({ path: "thinking", from: level, to: floor, why: "this model does not support the requested thinking level" });
      level = floor;
    }
    let attempts = 0;
    let transient = 0;
    let casingTried = false;
    let schemaTried = false;
    let mimeTried = false;
    let emptyTried = false;
    const model = r.model.replace(/^models\//, "");

    const done = (p: Partial<GeminiResponse>): GeminiResponse => ({
      ok: false, text: "", data: null, formatErrors: [], coercions, usage, model, ms: this.now() - t0, attempts, schemaMode: mode, ...p,
    });
    const fail = (errorKind: GeminiErrorKind, error: string, p: Partial<GeminiResponse> = {}) => done({ errorKind, error, ...p });

    for (;;) {
      const prompt = mode === "native" || !r.schema ? r.prompt : `${r.prompt}\n\nReply with only JSON matching this shape:\n${schemaAsPromptText(r.schema)}`;
      const generationConfig: Record<string, unknown> = {
        maxOutputTokens: r.maxOutputTokens ?? 16000,
        thinkingConfig: { thinkingLevel: this.upper ? level.toUpperCase() : level },
      };
      if (mode !== "none" && r.schema) generationConfig.responseMimeType = "application/json";
      if (mode === "native") generationConfig.responseJsonSchema = lowered;
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: r.system }] },
        contents: [{ role: "user", parts: [...(r.images ?? []).map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.data } })), { text: prompt }] }],
        generationConfig,
      });

      const raw = await this.send(`${this.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", body }, r.timeoutMs ?? 240000);
      attempts++;

      if (raw.fail) {
        if (transient < this.maxRetries) { await this.sleep(this.backoff(transient++)); continue; }
        return fail(raw.fail, raw.fail === "timeout" ? `${raw.failMsg} (${attempts} attempts); try a lower thinking level` : `network error: ${raw.failMsg}`);
      }

      if (raw.status !== 200) {
        const e = raw.json?.error;
        const message: string = String(e?.message ?? (raw.text.slice(0, 300) || `HTTP ${raw.status}`));
        const lc = message.toLowerCase();
        const st = raw.status;

        if (st === 401 || st === 403) return fail("auth", `authentication failed (${st}): ${message}. Check the Gemini API key.`);
        if (st === 404) return fail("not_found", `model "${model}" was not found: ${message}. Check the model id (listModels shows what this key can use).`);

        if (st === 429) {
          const daily = /per day|daily|quota exceeded for the day|perday/i.test(message) || /perday/i.test(JSON.stringify(e?.details ?? ""));
          if (daily) return fail("quota", `daily quota exhausted: ${message}`);
          if (transient >= this.maxRetries) return fail("rate", `rate limited after ${attempts} attempts: ${message}`);
          let wait = this.retryDelay(e?.details, message);
          if (wait === undefined && raw.retryAfterMs) wait = raw.retryAfterMs;
          if (wait !== undefined && wait > 120000) return fail("rate", `rate limited; the API asks to wait ${Math.round(wait / 1000)}s: ${message}`);
          await this.sleep(wait ?? this.backoff(transient));
          transient++;
          continue;
        }

        if (st >= 500 || st === 408) {
          if (transient < this.maxRetries) { await this.sleep(this.retryDelay(e?.details, "") ?? this.backoff(transient)); transient++; continue; }
          return fail("server", `Gemini server error ${st} after ${attempts} attempts: ${message}`);
        }

        if (st === 400) {
          if (/thinking/.test(lc)) {
            const next = LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(level) + 1)];
            if (/not supported|unsupported|does not support|doesn't support|not available|not allowed/.test(lc) && next !== level) {
              coercions.push({ path: "thinking", from: level, to: next, why: "this model does not support the requested thinking level" });
              this.floor.set(r.model, next);
              level = next;
              continue;
            }
            if (!casingTried) { casingTried = true; this.upper = !this.upper; continue; }
          }
          if (mode === "native" && !schemaTried && /schema|response_json_schema|too complex|nesting|enum|states/.test(lc)) { schemaTried = true; mode = "prompt"; continue; }
          if (mode !== "none" && r.schema && !mimeTried && /mime|response_mime_type|application\/json|json mode/.test(lc)) { mimeTried = true; mode = "none"; continue; }
          return fail("bad_request", `Gemini rejected the request: ${message}`);
        }
        return fail("bad_request", `unexpected HTTP ${st} from Gemini: ${message}`);
      }

      // 200
      const j = raw.json;
      if (!j || typeof j !== "object") {
        if (transient < this.maxRetries) { await this.sleep(this.backoff(transient++)); continue; }
        return fail("server", "Gemini returned a body that is not JSON");
      }
      const um = j.usageMetadata ?? {};
      usage.input += um.promptTokenCount ?? 0;
      usage.output += um.candidatesTokenCount ?? 0;
      usage.thoughts += um.thoughtsTokenCount ?? 0;
      usage.cached += um.cachedContentTokenCount ?? 0;

      const cand = j.candidates?.[0];
      if (!cand) {
        const why = j.promptFeedback?.blockReason;
        if (why) return fail("blocked", `the prompt was blocked (${why}${j.promptFeedback?.blockReasonMessage ? `: ${j.promptFeedback.blockReasonMessage}` : ""}); reword the request`, { finishReason: String(why) });
        return fail("empty", "Gemini returned no candidates");
      }
      const finishReason: string | undefined = cand.finishReason;
      const parts: any[] = Array.isArray(cand.content?.parts) ? cand.content.parts : [];
      const text = parts.filter((p) => p && !p.thought && typeof p.text === "string").map((p) => p.text).join("");

      if (finishReason === "MAX_TOKENS") {
        return fail("max_tokens", `ran out of output tokens (${usage.thoughts} spent thinking); raise maxOutputTokens or lower the thinking level`, { text, finishReason });
      }
      if (finishReason && BLOCKED.has(finishReason)) return fail("blocked", `the reply was blocked (${finishReason}); reword the request`, { text, finishReason });
      if (!text.trim()) {
        if (!emptyTried) { emptyTried = true; continue; }
        return fail("empty", `Gemini returned no text${finishReason ? ` (finish reason ${finishReason})` : ""}`, { finishReason });
      }

      if (!r.schema) return done({ ok: true, text, finishReason });
      const ex = extractJson(text);
      if (!ex.ok) return fail("format", ex.error, { text, formatErrors: [ex.error], finishReason });
      const v = validateAndCoerce(r.schema, ex.value);
      coercions.push(...v.coercions);
      if (v.errors.length) {
        const shown = v.errors.slice(0, 3).join("; ") + (v.errors.length > 3 ? `; and ${v.errors.length - 3} more` : "");
        return fail("format", `the reply did not match the schema: ${shown}`, { text, data: v.value, formatErrors: v.errors, finishReason });
      }
      return done({ ok: true, text, data: v.value, finishReason });
    }
  }

  /** Parse "12s" / "12.5s" from RetryInfo details, or "Please retry in 12.5s" from the message. */
  private retryDelay(details: unknown, message: string): number | undefined {
    if (Array.isArray(details)) {
      for (const d of details) {
        if (typeof d?.["@type"] === "string" && d["@type"].endsWith("RetryInfo") && d.retryDelay !== undefined) {
          const m = /^([\d.]+)s$/.exec(String(d.retryDelay));
          if (m) return Math.round(Number(m[1]) * 1000);
        }
      }
    }
    const m = /retry in ([\d.]+)\s*s/i.exec(message);
    return m ? Math.round(Number(m[1]) * 1000) : undefined;
  }

  async listModels(): Promise<string[]> {
    const out: string[] = [];
    let token = "";
    for (let page = 0; page < 50; page++) {
      const url = `${this.baseUrl}/v1beta/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`;
      let raw: Raw = await this.send(url, { method: "GET" }, 30000);
      for (let n = 0; (raw.fail || raw.status === 429 || raw.status >= 500) && n < this.maxRetries; n++) {
        await this.sleep(this.backoff(n));
        raw = await this.send(url, { method: "GET" }, 30000);
      }
      if (raw.fail) throw new Error(`could not list models: ${raw.failMsg}`);
      if (raw.status !== 200) throw new Error(`could not list models (${raw.status}): ${raw.json?.error?.message ?? raw.text.slice(0, 200)}`);
      for (const m of raw.json?.models ?? []) {
        if (typeof m?.name === "string" && Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent")) out.push(m.name.replace(/^models\//, ""));
      }
      token = raw.json?.nextPageToken ?? "";
      if (!token) break;
    }
    return out;
  }
}
