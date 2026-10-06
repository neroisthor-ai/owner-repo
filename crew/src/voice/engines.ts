// Text-to-speech engines for temp dialogue.
//
//  kokoro   Kokoro-82M in Node (kokoro-js / ONNX). Voices are *designed* the way
//           The Bob did it: a weighted blend of Kokoro style vectors per character
//           ("bf_emma:0.62+af_heart:0.38"), plus a base speed and accent.
//  walla    No model needed: a voiced murmur with the line's natural timing, so
//           timing, lip-sync and the cut all work offline.
//  command  Any external TTS (e.g. tools/kokoro_onnx_tts.py, the original Python
//           path): JSON on stdin, WAV on stdout. Set CREW_TTS_CMD.

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { decodeWav, type Pcm } from "./dsp.ts";
import { GeminiTtsEngine, hasGeminiKey } from "./gemini-tts.ts";

export interface VoiceDesign {
  blend: [string, number][]; // Kokoro voice ids and weights
  lang: "en-us" | "en-gb";
  speed: number; // base speed multiplier for this character
  /** who is speaking, for engines that pick a voice per character (Gemini) */
  actor?: string;
}

export interface TtsEngine {
  readonly name: string;
  synth(text: string, design: VoiceDesign, speed: number, direction?: string): Promise<Pcm>;
}

export const KOKORO_VOICES = [
  "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
  "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa",
  "bf_emma", "bf_isabella", "bf_alice", "bf_lily", "bm_george", "bm_lewis", "bm_daniel", "bm_fable",
];

/** "bf_emma:0.62+af_heart:0.38" -> [["bf_emma",0.62],["af_heart",0.38]] (weights normalised). */
export function parseBlend(spec: string): [string, number][] {
  const parts = spec.split("+").map((p) => { const [v, w] = p.split(":"); return [v.trim(), w === undefined ? 1 : Number(w)] as [string, number]; });
  for (const [v, w] of parts) {
    if (!KOKORO_VOICES.includes(v)) throw new Error(`unknown Kokoro voice "${v}" (have: ${KOKORO_VOICES.join(" ")})`);
    if (!(w > 0)) throw new Error(`voice weight for ${v} must be positive`);
  }
  const sum = parts.reduce((a, [, w]) => a + w, 0);
  return parts.map(([v, w]) => [v, Math.round((w / sum) * 1000) / 1000]);
}

export const printBlend = (b: [string, number][]) => b.map(([v, w]) => (b.length === 1 ? v : `${v}:${w}`)).join("+");

// ---------------------------------------------------------------- kokoro (Node)

export class KokoroEngine implements TtsEngine {
  readonly name = "kokoro";
  private tts: Promise<{ model: (i: unknown) => Promise<{ waveform: { data: Float32Array } }>; generate: (t: string, o: { voice: string; speed: number }) => Promise<{ audio: Float32Array; sampling_rate: number }>; generate_from_ids: unknown }> | null = null;
  private styles = new Map<string, Float32Array>();
  constructor(private dtype = process.env.CREW_KOKORO_DTYPE ?? "q8") {}

  private voicesDir() {
    const req = createRequire(import.meta.url);
    return join(dirname(req.resolve("kokoro-js")), "..", "voices");
  }
  private style(id: string): Float32Array {
    let s = this.styles.get(id);
    if (!s) {
      const f = join(this.voicesDir(), `${id}.bin`);
      if (!existsSync(f)) throw new Error(`Kokoro voice file missing: ${f}`);
      const b = readFileSync(f);
      s = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      this.styles.set(id, s);
    }
    return s;
  }
  /** weighted sum of style tables, exactly how The Bob blended voices (np.sum(w * VV[n])) */
  blendStyle(blend: [string, number][]): Float32Array {
    const out = new Float32Array(this.style(blend[0][0]).length);
    for (const [id, w] of blend) { const s = this.style(id); for (let i = 0; i < out.length; i++) out[i] += s[i] * w; }
    return out;
  }
  private load() {
    if (!this.tts) {
      this.tts = (async () => {
        const { KokoroTTS } = await import("kokoro-js");
        return (await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: this.dtype as "q8" })) as never;
      })();
    }
    return this.tts;
  }
  async synth(text: string, d: VoiceDesign, speed: number): Promise<Pcm> {
    const tts = await this.load();
    const { Tensor } = await import("@huggingface/transformers");
    const style = this.blendStyle(d.blend);
    // the phonemiser's accent follows the first letter of the voice id (a = US, b = UK)
    const primary = d.blend.find(([v]) => v[0] === (d.lang === "en-gb" ? "b" : "a"))?.[0] ?? (d.lang === "en-gb" ? "bf_emma" : "af_heart");
    const orig = tts.generate_from_ids;
    (tts as { generate_from_ids: unknown }).generate_from_ids = async (ids: { dims: number[] }, o: { speed: number }) => {
      const l = 256 * Math.min(Math.max(ids.dims.at(-1)! - 2, 0), 509);
      const { waveform } = await tts.model({ input_ids: ids, style: new Tensor("float32", style.slice(l, l + 256), [1, 256]), speed: new Tensor("float32", [o.speed], [1]) });
      return { audio: waveform.data, sampling_rate: 24000 };
    };
    try {
      const r = await tts.generate(text, { voice: primary, speed: d.speed * speed });
      return { samples: Float32Array.from(r.audio), sampleRate: r.sampling_rate };
    } finally {
      (tts as { generate_from_ids: unknown }).generate_from_ids = orig;
    }
  }
}

// ---------------------------------------------------------------- walla (offline)

export class WallaEngine implements TtsEngine {
  readonly name = "walla";
  constructor(private wpm = 160) {}
  async synth(text: string, d: VoiceDesign, speed: number): Promise<Pcm> {
    const sr = 24000;
    const words = text.split(/\s+/).filter(Boolean);
    const breaks = (text.match(/[.?!;:—…]\s+\S/g) ?? []).length;
    const dur = Math.max(0.5, (words.length / (this.wpm * d.speed * speed)) * 60 + breaks * 0.3);
    const n = Math.round(dur * sr), out = new Float32Array(n);
    const female = d.blend[0][0][1] === "f";
    const f0 = female ? 205 : 118;
    const syll = Math.max(1, Math.round(words.reduce((a, w) => a + Math.max(1, w.replace(/[^aeiouy]+/gi, " ").trim().split(" ").length), 0)));
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, u = (t / dur) * syll, k = u - Math.floor(u);
      const env = Math.sin(Math.PI * Math.min(1, k / 0.8)) ** 1.5 * (Math.floor(u) % 7 === 6 && breaks ? 0.2 : 1);
      ph += (2 * Math.PI * f0 * (1 + 0.06 * Math.sin(Math.floor(u) * 1.7) - 0.08 * (t / dur))) / sr;
      // a few formant-ish harmonics: open vowels read as speech-shaped energy
      out[i] = env * (0.5 * Math.sin(ph) + 0.25 * Math.sin(2 * ph) + 0.18 * Math.sin(3 * ph) + 0.1 * Math.sin(5 * ph)) * 0.3;
    }
    return { samples: out, sampleRate: sr };
  }
}

// ---------------------------------------------------------------- external command

export class CommandEngine implements TtsEngine {
  readonly name = "command";
  constructor(private cmd = process.env.CREW_TTS_CMD ?? "") {}
  synth(text: string, design: VoiceDesign, speed: number): Promise<Pcm> {
    if (!this.cmd) return Promise.reject(new Error("set CREW_TTS_CMD to a command that reads JSON on stdin and writes a WAV to stdout"));
    return new Promise((ok, fail) => {
      const p = spawn(this.cmd, { shell: true, stdio: ["pipe", "pipe", "pipe"] });
      const chunks: Buffer[] = [], err: Buffer[] = [];
      p.stdout.on("data", (d) => chunks.push(d));
      p.stderr.on("data", (d) => err.push(d));
      p.on("error", fail);
      p.on("close", (code) => {
        if (code !== 0) return fail(new Error(`TTS command failed (${code}): ${Buffer.concat(err).toString().slice(0, 400)}`));
        try { ok(decodeWav(Buffer.concat(chunks))); } catch (e) { fail(e); }
      });
      p.stdin.end(JSON.stringify({ text, blend: design.blend, lang: design.lang, speed: design.speed * speed }));
    });
  }
}

export function pickEngine(name = process.env.CREW_TTS ?? "auto"): TtsEngine {
  if (name === "gemini" || (name === "auto" && !process.env.CREW_TTS && hasGeminiKey())) return new GeminiTtsEngine();
  if (name === "walla") return new WallaEngine();
  if (name === "command" || (name === "auto" && process.env.CREW_TTS_CMD)) return new CommandEngine();
  return new KokoroEngine();
}
