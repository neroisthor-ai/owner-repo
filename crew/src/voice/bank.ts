// A show's voice bank: every dialogue line rendered once, content-addressed by
// (character voice design, verb, text), with its real duration and a mouth track
// analysed from the audio. The compiler reads durations from here, so the cut is
// timed to the actual performances (The Bob's timeline.py idea), and the
// animatic drives mouths from the lip track (lipsync.py).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CastMember, Show } from "../scene/ast.ts";
import { encodeWav, finish, humanize, lipTrack, trim } from "./dsp.ts";
import { parseBlend, printBlend, type TtsEngine, type VoiceDesign } from "./engines.ts";

export interface Clip {
  key: string;
  file: string;
  duration: number;
  sampleRate: number;
  lips: string; // base64, 4 bytes per frame at 30 fps: open, wide, round, emphasis
  char: string;
  verb: string;
  text: string;
  design: string;
  engine: string;
  at: string;
}

export interface VoiceHit { duration: number; lips: Uint8Array; url: string; key: string }
export type VoiceLookup = (actor: string, verb: string, text: string) => VoiceHit | null;

/** Voice design presets. The Bob's cast blends ship in library/voices/presets.json; these are fallbacks. */
const DEFAULT_DESIGN: Record<string, VoiceDesign> = {
  female: { blend: [["af_heart", 1]], lang: "en-us", speed: 1 },
  male: { blend: [["am_michael", 1]], lang: "en-us", speed: 1 },
  neutral: { blend: [["af_heart", 0.5], ["am_michael", 0.5]], lang: "en-us", speed: 1 },
};

const VERB_FX: Record<string, { speed: number; gain: number }> = { say: { speed: 1, gain: 1 }, whisper: { speed: 0.9, gain: 0.45 }, shout: { speed: 1.08, gain: 1.3 } };

export function loadPresets(libraryDir: string): Record<string, VoiceDesign & { note?: string }> {
  const f = join(libraryDir, "voices", "presets.json");
  if (!existsSync(f)) return {};
  const j = JSON.parse(readFileSync(f, "utf8")) as { presets: Record<string, { blend: string; lang: VoiceDesign["lang"]; speed: number; note?: string }> };
  return Object.fromEntries(Object.entries(j.presets).map(([k, p]) => [k, { blend: parseBlend(p.blend), lang: p.lang, speed: p.speed, note: p.note }]));
}

/** The voice design for a cast member: explicit blend, a library preset, or a default from `voice`. */
export function designFor(c: CastMember, presets: Record<string, VoiceDesign>): VoiceDesign {
  if (c.tts?.startsWith("preset:")) {
    const p = presets[c.tts.slice(7)];
    if (!p) throw new Error(`no voice preset "${c.tts.slice(7)}" (have: ${Object.keys(presets).join(", ") || "none"})`);
    return { ...p, lang: (c.lang as VoiceDesign["lang"]) ?? p.lang, speed: c.ttsSpeed ?? p.speed };
  }
  if (c.tts) {
    const blend = parseBlend(c.tts);
    return { blend, lang: (c.lang as VoiceDesign["lang"]) ?? (blend[0][0][0] === "b" ? "en-gb" : "en-us"), speed: c.ttsSpeed ?? 1 };
  }
  const d = DEFAULT_DESIGN[/female|woman/i.test(c.voice) ? "female" : /male|man/i.test(c.voice) ? "male" : "neutral"];
  return { ...d, lang: (c.lang as VoiceDesign["lang"]) ?? d.lang, speed: c.ttsSpeed ?? d.speed };
}

export class VoiceBank {
  readonly dir: string;
  clips: Record<string, Clip> = {};
  private lipCache = new Map<string, Uint8Array>();

  constructor(showDir: string, readonly urlBase = "/show-media/voices", private libraryDir = "") {
    this.dir = join(showDir, "voices");
    const m = join(this.dir, "voices.json");
    if (existsSync(m)) this.clips = (JSON.parse(readFileSync(m, "utf8")) as { clips: Record<string, Clip> }).clips;
  }

  presets() { return this.libraryDir ? loadPresets(this.libraryDir) : {}; }

  key(design: VoiceDesign, verb: string, text: string) {
    return createHash("sha1").update(JSON.stringify([printBlend(design.blend), design.lang, design.speed, verb, text.trim()])).digest("hex").slice(0, 16);
  }

  private save() {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, "voices.json"), JSON.stringify({ format: "crew voice bank v1", clips: this.clips }, null, 1));
  }

  /** The compiler's view: real duration + mouth track for a line, if it has been rendered with the current design. */
  lookup(show: Show): VoiceLookup {
    const presets = this.presets();
    const designs = new Map<string, VoiceDesign | null>();
    return (actor, verb, text) => {
      if (!designs.has(actor)) {
        const c = show.cast[actor];
        let d: VoiceDesign | null = null;
        try { d = c ? designFor(c, presets) : null; } catch { d = null; }
        designs.set(actor, d);
      }
      const d = designs.get(actor);
      if (!d) return null;
      const k = this.key(d, verb, text);
      const clip = this.clips[k];
      if (!clip || !existsSync(join(this.dir, clip.file))) return null;
      let lips = this.lipCache.get(k);
      if (!lips) { lips = new Uint8Array(Buffer.from(clip.lips, "base64")); this.lipCache.set(k, lips); }
      return { duration: clip.duration, lips, url: `${this.urlBase}/${clip.file}`, key: k };
    };
  }

  /** Render (or reuse) every line. Lines already in the bank with the same design and text are skipped. */
  async render(
    show: Show,
    lines: { actor: string; verb: string; text: string }[],
    engine: TtsEngine,
    o: { force?: boolean; onProgress?: (done: number, total: number, line: string, cached: boolean) => void } = {},
  ) {
    const presets = this.presets();
    mkdirSync(this.dir, { recursive: true });
    let made = 0, cached = 0;
    const failed: { line: string; error: string }[] = [];
    const seen = new Set<string>();
    const todo = lines.filter((l) => { const id = `${l.actor}|${l.verb}|${l.text}`; if (seen.has(id)) return false; seen.add(id); return true; });
    for (const [i, l] of todo.entries()) {
      const c = show.cast[l.actor];
      const label = `${l.actor}: ${l.text}`;
      try {
        if (!c) throw new Error(`unknown character ${l.actor}`);
        const d = designFor(c, presets);
        const k = this.key(d, l.verb, l.text);
        const have = this.clips[k];
        // a real voice replaces a walla placeholder; a walla run never replaces a real voice
        if (!o.force && have && existsSync(join(this.dir, have.file)) && (have.engine === engine.name || engine.name === "walla")) { cached++; o.onProgress?.(i + 1, todo.length, label, true); continue; }
        const fx = VERB_FX[l.verb] ?? VERB_FX.say;
        const raw = await engine.synth(l.text, d, fx.speed);
        let x = trim(raw.samples, raw.sampleRate);
        if (engine.name !== "walla") x = humanize(x, raw.sampleRate, parseInt(k.slice(0, 8), 16));
        x = finish(x, raw.sampleRate, 0.08 * fx.gain);
        const pcm = { samples: x, sampleRate: raw.sampleRate };
        const file = `${l.actor}_${k}.wav`;
        writeFileSync(join(this.dir, file), encodeWav(pcm));
        this.clips[k] = {
          key: k, file, duration: Math.round((x.length / raw.sampleRate) * 1000) / 1000, sampleRate: raw.sampleRate,
          lips: Buffer.from(lipTrack(pcm)).toString("base64"), char: l.actor, verb: l.verb, text: l.text,
          design: `${printBlend(d.blend)} ${d.lang} x${d.speed}`, engine: engine.name, at: new Date().toISOString(),
        };
        this.lipCache.delete(k);
        this.save();
        made++;
        o.onProgress?.(i + 1, todo.length, label, false);
      } catch (e) {
        failed.push({ line: label, error: (e as Error).message });
        o.onProgress?.(i + 1, todo.length, label, false);
      }
    }
    return { made, cached, failed, total: todo.length };
  }

  /** Delete clips no line uses any more. */
  prune(keep: Set<string>) {
    let n = 0;
    for (const [k, c] of Object.entries(this.clips)) {
      if (keep.has(k)) continue;
      try { unlinkSync(join(this.dir, c.file)); } catch { /* gone already */ }
      delete this.clips[k];
      n++;
    }
    for (const f of existsSync(this.dir) ? readdirSync(this.dir) : []) {
      if (f.endsWith(".wav") && !Object.values(this.clips).some((c) => c.file === f)) { try { unlinkSync(join(this.dir, f)); n++; } catch { /* ignore */ } }
    }
    this.save();
    return n;
  }
}
