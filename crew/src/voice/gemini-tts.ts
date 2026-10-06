// Gemini text-to-speech engine. One generateContent call per line, audio comes back as
// base64 raw 16-bit LE mono PCM in candidates[0].content.parts[0].inlineData.
// Voice per character: a prebuilt Gemini voice picked from the Kokoro blend (sex by prefix,
// hashed by blend string), or CREW_GEMINI_VOICES="kiran=Puck,mum=Kore".
// Delivery is steered by a short direction in the prompt, never by time-stretching.
// `fetch` and `sleep` are injectable for tests.

import { createHash } from "node:crypto";
import type { Pcm } from "./dsp.ts";
import { printBlend, type TtsEngine, type VoiceDesign } from "./engines.ts";

export const GEMINI_FEMALE = ["Kore", "Aoede", "Leda", "Zephyr"];
export const GEMINI_MALE = ["Puck", "Charon", "Fenrir", "Orus"];
const OUT_RATE = 24000;

export const hasGeminiKey = () => !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

export interface GeminiTtsOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
  /** explicit voice per character, overrides CREW_GEMINI_VOICES */
  voices?: Record<string, string>;
}

/** "kiran=Puck,mum=Kore" -> { kiran: "Puck", mum: "Kore" } */
export function parseVoiceMap(spec: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of spec.split(",")) {
    const [k, v] = p.split("=").map((x) => x?.trim());
    if (!k && !v) continue;
    if (!k || !v) throw new Error(`bad CREW_GEMINI_VOICES entry "${p}" (use name=Voice,name=Voice)`);
    out[k.toLowerCase()] = v;
  }
  return out;
}

/** Deterministic prebuilt voice for a design: sex from the blend's first prefix, pick hashed by the blend. */
export function geminiVoiceFor(design: VoiceDesign): string {
  const female = design.blend[0][0][1] === "f";
  const list = female ? GEMINI_FEMALE : GEMINI_MALE;
  return list[createHash("sha1").update(printBlend(design.blend)).digest()[0] % list.length];
}

/** Rate from "audio/L16;codec=pcm;rate=24000", default 24000. */
export function rateFromMime(mime: string): number {
  const m = /rate=(\d+)/i.exec(mime);
  return m ? Number(m[1]) : OUT_RATE;
}

/** 16-bit LE mono PCM bytes -> floats. */
export function decodePcm16(buf: Buffer): Float32Array {
  const n = Math.floor(buf.length / 2), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}

export function resampleLinear(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to || x.length === 0) return x;
  const n = Math.max(1, Math.round((x.length * to) / from)), out = new Float32Array(n), r = from / to;
  for (let i = 0; i < n; i++) {
    const p = i * r, k = Math.floor(p), f = p - k;
    out[i] = x[Math.min(k, x.length - 1)] * (1 - f) + x[Math.min(k + 1, x.length - 1)] * f;
  }
  return out;
}

export class GeminiTtsEngine implements TtsEngine {
  readonly name = "gemini";
  private o: GeminiTtsOptions;
  constructor(o: GeminiTtsOptions = {}) { this.o = o; }

  /** the character a design belongs to is not known here, so overrides match by voice name or blend string */
  private voice(d: VoiceDesign): string {
    const map = this.o.voices ?? parseVoiceMap(process.env.CREW_GEMINI_VOICES ?? "");
    const hit = map[printBlend(d.blend).toLowerCase()] ?? map[d.blend[0][0].toLowerCase()];
    return hit ?? geminiVoiceFor(d);
  }

  /** voice override by character name, for callers that know it */
  voiceForChar(char: string, d: VoiceDesign): string {
    const map = this.o.voices ?? parseVoiceMap(process.env.CREW_GEMINI_VOICES ?? "");
    return map[char.toLowerCase()] ?? this.voice(d);
  }

  async synth(text: string, design: VoiceDesign, speed: number, direction?: string): Promise<Pcm> {
    const key = this.o.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
    if (!key) throw new Error("Gemini TTS needs an API key: set GEMINI_API_KEY (or GOOGLE_API_KEY)");
    const model = (this.o.model ?? process.env.CREW_GEMINI_TTS ?? "gemini-3.8-flash-tts").replace(/^models\//, "");
    const base = (this.o.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
    const f = this.o.fetch ?? fetch;
    const sleep = this.o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    const maxRetries = this.o.maxRetries ?? 4;
    const timeoutMs = this.o.timeoutMs ?? 120000;

    let dir = (direction ?? "Say naturally").trim().replace(/[:\s]+$/, "");
    const rel = design.speed * speed;
    if (Math.abs(rel - 1) > 0.04) dir += rel > 1 ? ", a little faster" : ", a little slower";
    const body = JSON.stringify({
      contents: [{ parts: [{ text: `${dir}: "${text.trim()}"` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: design.actor ? this.voiceForChar(design.actor, design) : this.voice(design) } } },
      },
    });
    const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    for (let n = 0; ; n++) {
      let status = 0, textBody = "", fail = "";
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await f(url, { method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" }, body, signal: ctl.signal });
        status = res.status;
        textBody = await res.text();
      } catch (e) {
        fail = ctl.signal.aborted ? `no reply within ${Math.round(timeoutMs / 1000)}s` : (e as Error)?.message ?? String(e);
      } finally {
        clearTimeout(timer);
      }
      let json: any = null;
      try { json = JSON.parse(textBody); } catch { /* non-JSON */ }
      const msg = String(json?.error?.message ?? (textBody.slice(0, 300) || `HTTP ${status}`));

      if (fail || status === 429 || status >= 500 || status === 408) {
        if (n < maxRetries) { await sleep(Math.min(60000, 2000 * 2 ** n * (0.75 + Math.random() * 0.5))); continue; }
        throw new Error(fail ? `Gemini TTS network error after ${n + 1} attempts: ${fail}` : `Gemini TTS failed (${status}) after ${n + 1} attempts: ${msg}`);
      }
      if (status === 401 || status === 403) throw new Error(`Gemini TTS authentication failed (${status}): ${msg}. Check GEMINI_API_KEY.`);
      if (status === 404) throw new Error(`Gemini TTS model "${model}" was not found: ${msg}. Set CREW_GEMINI_TTS to a TTS model id this key can use.`);
      if (status !== 200) throw new Error(`Gemini TTS rejected the request (${status}): ${msg}`);

      const cand = json?.candidates?.[0];
      const parts: any[] = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
      const part = parts.find((p) => (p?.inlineData ?? p?.inline_data)?.data);
      if (!part) {
        const why = json?.promptFeedback?.blockReason ?? cand?.finishReason;
        throw new Error(`Gemini TTS returned no audio${why ? ` (${why})` : ""}; model "${model}" may not be a TTS model, set CREW_GEMINI_TTS`);
      }
      const inl = part.inlineData ?? part.inline_data;
      const mime = String(inl.mimeType ?? inl.mime_type ?? "");
      const pcm = decodePcm16(Buffer.from(String(inl.data), "base64"));
      if (!pcm.length) throw new Error("Gemini TTS returned empty audio");
      return { samples: resampleLinear(pcm, rateFromMime(mime), OUT_RATE), sampleRate: OUT_RATE };
    }
  }
}
