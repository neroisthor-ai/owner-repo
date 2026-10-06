// Master export: render the cut to MP4 in the browser with WebCodecs.
// Codec probing after Odyssey's master(); part files cut on shot boundaries,
// resumable from any part, wake lock and GPU-reset detection after The Bob's
// renderFilm(). Long-job gates from the Crew plan: a short test on this machine
// first, a projected finish time, clear errors, and a plan B.
import { Muxer, ArrayBufferTarget } from "/vendor/mp4-muxer/mp4-muxer.mjs";
import { renderAudio } from "./audio.js";

export const PRESETS = {
  "720p": { w: 1280, h: 720, br: 6e6 },
  "1080p": { w: 1920, h: 1080, br: 12e6 },
  "1440p": { w: 2560, h: 1440, br: 20e6 },
  "4K": { w: 3840, h: 2160, br: 40e6 },
};

export async function pickVideoConfig(w, h, br, fps) {
  if (!("VideoEncoder" in window)) return null;
  const cands = [
    { codec: "avc1.640034", mux: "avc", extra: { avc: { format: "avc" } } },
    { codec: "avc1.640033", mux: "avc", extra: { avc: { format: "avc" } } },
    { codec: "avc1.640028", mux: "avc", extra: { avc: { format: "avc" } } },
    { codec: "hvc1.1.6.L156.B0", mux: "hevc", extra: { hevc: { format: "hevc" } } },
    { codec: "vp09.00.51.08", mux: "vp9", extra: {} },
    { codec: "av01.0.16M.08", mux: "av1", extra: {} },
  ];
  for (const c of cands) {
    const cfg = { codec: c.codec, width: w, height: h, bitrate: br, framerate: fps, latencyMode: "quality", bitrateMode: "variable", ...c.extra };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, mux: c.mux }; } catch { /* try next */ }
  }
  return null;
}

export async function pickAudioConfig(sampleRate = 48000) {
  if (!("AudioEncoder" in window)) return null;
  for (const c of [{ codec: "mp4a.40.2", mux: "aac" }, { codec: "opus", mux: "opus" }]) {
    const cfg = { codec: c.codec, sampleRate, numberOfChannels: 2, bitrate: 192000 };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux: c.mux }; } catch { /* try next */ }
  }
  return null;
}

/** Part boundaries in frames, only ever on shot cuts so joins are invisible. */
export function planParts(baked, partSec) {
  const total = Math.round(baked.duration * baked.fps);
  const cuts = baked.shots.map((s) => Math.round(s.cutStart * baked.fps)).filter((f) => f > 0 && f < total);
  const parts = [0];
  if (partSec > 0) { let last = 0; for (const c of cuts) if (c - last >= partSec * baked.fps) { parts.push(c); last = c; } }
  parts.push(total);
  return parts;
}

const fmt = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return m ? `${m}m ${s % 60}s` : `${s}s`; };
const tc = (t, fps) => { const f = Math.round(t * fps); const s = Math.floor(f / fps); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}:${String(f % fps).padStart(2, "0")}`; };

export class MasterRender {
  constructor({ player, baked, title, preset = "1080p", burnIn = true, partSec = 0, onStatus = () => {}, onProgress = () => {}, onPart = () => {} }) {
    Object.assign(this, { player, baked, title, burnIn, partSec, onStatus, onProgress, onPart });
    this.p = PRESETS[preset] ?? PRESETS["1080p"];
    this.stopReq = false;
    this.comp = document.createElement("canvas");
    this.comp.width = this.p.w; this.comp.height = this.p.h;
    this.g = this.comp.getContext("2d");
  }

  stop() { this.stopReq = true; }

  drawFrame(t) {
    const r = this.player.frame(t);
    const g = this.g, W = this.p.w, H = this.p.h;
    g.drawImage(this.player.canvas, 0, 0, W, H);
    if (!this.burnIn || !r) return;
    const s = r.shot, px = Math.round(H / 40);
    g.font = `600 ${px}px ui-monospace, Menlo, monospace`;
    g.textBaseline = "top";
    const label = `${s.id}  ${s.label}  ${Math.round(s.lens)}mm ${s.move}`;
    const box = (x, y, text, align = "left") => {
      const w = g.measureText(text).width;
      const bx = align === "right" ? x - w - px * 0.6 : x;
      g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(bx, y, w + px * 0.6, px * 1.5);
      g.fillStyle = "#fff"; g.fillText(text, bx + px * 0.3, y + px * 0.25);
    };
    box(px, px, label);
    box(W - px, px, tc(t, this.baked.fps), "right");
    box(px, H - px * 2.5, `CREW ANIMATIC  ${this.title}  ${s.hash}`);
    const line = this.baked.audio.find((e) => e.type === "say" && t >= e.t && t < e.t + e.dur);
    if (line) {
      g.font = `500 ${px * 1.4}px -apple-system, system-ui, sans-serif`;
      const text = `${this.baked.cast[line.char]?.name ?? line.char}: ${line.text}`;
      const w = g.measureText(text).width;
      g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect((W - w) / 2 - px, H - px * 5.4, w + px * 2, px * 2.1);
      g.fillStyle = "#fff"; g.fillText(text, (W - w) / 2, H - px * 5.1);
    }
  }

  async encodePart(fA, fB, vc, ac, { dry = false } = {}) {
    const fps = this.baked.fps;
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: vc.mux, width: this.p.w, height: this.p.h, frameRate: fps }, audio: ac ? { codec: ac.mux, numberOfChannels: 2, sampleRate: ac.cfg.sampleRate } : undefined, fastStart: "in-memory", firstTimestampBehavior: "offset" });
    let err = null;
    const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { err = e; } });
    venc.configure(vc.cfg);
    if (ac && !dry) {
      const buf = await renderAudio(this.baked.audio, this.baked.cast, fA / fps, fB / fps, ac.cfg.sampleRate);
      const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { err = e; } });
      aenc.configure(ac.cfg);
      const L = buf.getChannelData(0), R = buf.getChannelData(1), sr = buf.sampleRate;
      for (let i = 0; i < buf.length; i += sr) {
        const n = Math.min(sr, buf.length - i);
        const data = new Float32Array(n * 2);
        data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
        const ad = new AudioData({ format: "f32-planar", sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / sr) * 1e6), data });
        aenc.encode(ad); ad.close();
      }
      await aenc.flush(); aenc.close();
    }
    const t0 = performance.now();
    for (let f = fA; f < fB; f++) {
      if (this.stopReq) break;
      if (err) throw err;
      if (this.glLost) throw new Error("the graphics card reset (WebGL context lost). Plan B: lower the resolution or close other GPU-heavy tabs, then resume from this part.");
      this.drawFrame(f / fps);
      const vf = new VideoFrame(this.comp, { timestamp: Math.round(((f - fA) / fps) * 1e6), duration: Math.round(1e6 / fps) });
      venc.encode(vf, { keyFrame: (f - fA) % (fps * 2) === 0 });
      vf.close();
      while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1));
      if ((f - fA) % 6 === 0) { this.onProgress(f); await new Promise((r) => setTimeout(r, 0)); }
    }
    await venc.flush(); venc.close();
    if (err) throw err;
    muxer.finalize();
    return { blob: new Blob([target.buffer], { type: "video/mp4" }), ms: performance.now() - t0 };
  }

  async setup() {
    const vc = await pickVideoConfig(this.p.w, this.p.h, this.p.br, this.baked.fps);
    if (!vc) throw new Error(`this browser can't encode ${this.p.w}x${this.p.h}. Plan B: pick a smaller size, or use desktop Chrome/Edge.`);
    const ac = await pickAudioConfig();
    this.player.setFixedSize([this.p.w, this.p.h]);
    this.onLost = (e) => { e.preventDefault(); this.glLost = true; };
    this.player.canvas.addEventListener("webglcontextlost", this.onLost);
    try { this.wake = await navigator.wakeLock?.request("screen"); } catch { this.wake = null; }
    return { vc, ac };
  }

  teardown() {
    this.player.setFixedSize(null);
    this.player.canvas.removeEventListener("webglcontextlost", this.onLost);
    try { this.wake?.release(); } catch { /* already released */ }
  }

  /** Gate 1: a short test on this machine; returns the projected time for the whole cut. */
  async test(seconds = 2) {
    const { vc, ac } = await this.setup();
    try {
      const fps = this.baked.fps;
      const n = Math.min(Math.round(seconds * fps), Math.round(this.baked.duration * fps));
      const start = Math.round(this.baked.duration * fps * 0.4);
      const t0 = performance.now();
      await this.encodePart(start, Math.min(start + n, Math.round(this.baked.duration * fps)), vc, ac, { dry: true });
      const perFrame = (performance.now() - t0) / n;
      const total = Math.round(this.baked.duration * fps);
      const projected = (perFrame * total) / 1000 * 1.1;
      this.onStatus(`Test: ${(1000 / perFrame).toFixed(0)} frames/s at ${this.p.w}x${this.p.h} (${vc.mux.toUpperCase()}${ac ? " + " + ac.mux.toUpperCase() : ", no audio encoder"}). Projected: ${fmt(projected)} for ${fmt(this.baked.duration)} of film.`);
      return { fps: 1000 / perFrame, projected, codec: vc.mux, audio: ac?.mux ?? null };
    } finally { this.teardown(); }
  }

  /** Render parts [from, to). Each finished part is handed to onPart immediately, so a crash loses at most one part. */
  async run(fromPart = 1) {
    const { vc, ac } = await this.setup();
    const bounds = planParts(this.baked, this.partSec);
    const nParts = bounds.length - 1;
    const total = bounds[nParts] - bounds[fromPart - 1];
    const t0 = performance.now();
    const firstF = bounds[fromPart - 1];
    this.onProgress = ((inner) => (f) => {
      const done = f - firstF, el = (performance.now() - t0) / 1000;
      inner(done / total, done > 12 ? (el / done) * (total - done) : null);
    })(this.onProgress);
    try {
      for (let i = fromPart - 1; i < nParts && !this.stopReq; i++) {
        this.onStatus(`Rendering part ${i + 1} of ${nParts}…`);
        const { blob } = await this.encodePart(bounds[i], bounds[i + 1], vc, ac);
        if (this.stopReq) { this.onStatus(`Stopped. Resume from part ${i + 1}.`); break; }
        this.onPart({ index: i + 1, of: nParts, blob, from: bounds[i] / this.baked.fps, to: bounds[i + 1] / this.baked.fps });
      }
      if (!this.stopReq) this.onStatus(`Done in ${fmt((performance.now() - t0) / 1000)}. Dialogue is a timing track (browser voices can't be recorded).`);
    } finally { this.teardown(); }
  }
}
