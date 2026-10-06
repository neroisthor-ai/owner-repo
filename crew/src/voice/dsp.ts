// Audio DSP for temp voices, ported from The Bob's pipeline (humanvo.py, lipsync.py):
// WAV I/O, trim, breaths in sentence gaps, high-pass, loudness, and mouth tracks.

// ---------------------------------------------------------------- WAV

export interface Pcm { samples: Float32Array; sampleRate: number }

export function encodeWav({ samples, sampleRate }: Pcm): Buffer {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return b;
}

export function decodeWav(buf: Buffer): Pcm {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let p = 12, fmt = 1, channels = 1, sampleRate = 24000, bits = 16;
  while (p + 8 <= buf.length) {
    const id = buf.toString("ascii", p, p + 4), size = buf.readUInt32LE(p + 4);
    if (id === "fmt ") { fmt = buf.readUInt16LE(p + 8); channels = buf.readUInt16LE(p + 10); sampleRate = buf.readUInt32LE(p + 12); bits = buf.readUInt16LE(p + 22); }
    if (id === "data") {
      const bps = bits / 8, n = Math.floor(size / (bps * channels)), out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) {
          const o = p + 8 + (i * channels + c) * bps;
          s += fmt === 3 ? buf.readFloatLE(o) : bits === 16 ? buf.readInt16LE(o) / 32768 : bits === 24 ? buf.readIntLE(o, 3) / 8388608 : bits === 32 ? buf.readInt32LE(o) / 2147483648 : (buf[o] - 128) / 128;
        }
        out[i] = s / channels;
      }
      return { samples: out, sampleRate };
    }
    p += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

// ---------------------------------------------------------------- filters (RBJ biquads; Q=1/sqrt2 = 2nd-order Butterworth)

function biquad(x: Float32Array, sr: number, type: "hp" | "lp", f: number, q = Math.SQRT1_2): Float32Array {
  const w = (2 * Math.PI * f) / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
  const b = type === "hp" ? [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2] : [(1 - cw) / 2, 1 - cw, (1 - cw) / 2];
  const a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al;
  const out = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b[0] * x[i] + b[1] * x1 + b[2] * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; out[i] = y;
  }
  return out;
}

/** Seeded RNG so the same line always breathes the same way (renders are deterministic). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}
function gauss(r: () => number) { return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()); }

// ---------------------------------------------------------------- humanize (port of humanvo.py)

export function trim(x: Float32Array, sr: number, th = 0.006): Float32Array {
  let a = -1, b = -1;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > th) { if (a < 0) a = i; b = i; }
  if (a < 0) return x;
  return x.slice(Math.max(0, a - Math.round(0.03 * sr)), Math.min(x.length, b + Math.round(0.08 * sr)));
}

function breath(n: number, sr: number, r: () => number): Float32Array {
  let x: Float32Array = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = gauss(r);
  x = biquad(biquad(x, sr, "hp", 500), sr, "lp", 2600);
  for (let i = 0; i < n; i++) { const t = i / Math.max(1, n - 1); x[i] *= Math.sin(Math.PI * t) ** 1.6 * (0.6 + 0.4 * t); }
  return x;
}

/** Find long gaps (sentence breaks) and lay a quiet breath into some of them. */
export function humanize(x: Float32Array, sr: number, seed = 11): Float32Array {
  const r = rng(seed);
  const n = x.length, out = x.slice();
  const win = 240;
  const env = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n + win / 2; i++) {
    if (i < n) acc += Math.abs(x[i]);
    if (i - win >= 0) acc -= Math.abs(x[i - win]);
    const c = i - win / 2;
    if (c >= 0 && c < n) env[c] = acc / win;
  }
  let pk = 1e-9;
  for (const v of x) pk = Math.max(pk, Math.abs(v));
  for (let i = 0; i < n;) {
    if (env[i] < 0.004) {
      let j = i;
      while (j < n && env[j] < 0.004) j++;
      const gap = (j - i) / sr;
      if (gap > 0.26 && i > sr * 0.3 && j < n - sr * 0.3 && r() < 0.65) {
        const L = Math.round(Math.min(gap * 0.7, 0.34) * sr), s = j - L - Math.round(0.03 * sr);
        if (s > i) { const br = breath(L, sr, r); for (let k = 0; k < L; k++) out[s + k] += br[k] * pk * 0.045; }
      }
      i = j;
    } else i++;
  }
  return out;
}

/** 70 Hz high-pass, RMS to 0.08, clip: the final step every line went through. */
export function finish(x: Float32Array, sr: number, rmsTarget = 0.08): Float32Array {
  const y = biquad(x, sr, "hp", 70);
  let ss = 0;
  for (const v of y) ss += v * v;
  const k = rmsTarget / (Math.sqrt(ss / Math.max(1, y.length)) + 1e-9);
  for (let i = 0; i < y.length; i++) y[i] = Math.max(-0.98, Math.min(0.98, y[i] * k));
  return y;
}

/** Mix several takes into one (The Bob's three witches speaking together). */
export function chorus(takes: Float32Array[], sr: number, seed = 5): Float32Array {
  const r = rng(seed);
  const pads = takes.map(() => Math.round(r() * 0.03 * sr));
  const n = Math.max(...takes.map((t, i) => t.length + pads[i]));
  const out = new Float32Array(n);
  takes.forEach((t, i) => { for (let k = 0; k < t.length; k++) out[k + pads[i]] += t[k] / 2.2; });
  return out;
}

// ---------------------------------------------------------------- lip-sync from audio (port of lipsync.py)

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar; im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar; im[i + k] += ai;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

export const LIPS_FPS = 30;

/**
 * Mouth shapes from real audio at 30 fps: open (loudness, closed on sibilants),
 * wide (bright vowels), round (dark vowels), emphasis (onsets). uint8 x4 per frame.
 */
export function lipTrack({ samples: x, sampleRate: sr }: Pcm): Uint8Array {
  const hop = Math.floor(sr / LIPS_FPS), win = Math.round(sr * 0.045), N = 1 << Math.ceil(Math.log2(win));
  const n = Math.ceil(x.length / hop);
  const rms = new Float64Array(n), cen = new Float64Array(n), hi = new Float64Array(n);
  const hann = Float64Array.from({ length: win }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1)));
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < n; f++) {
    re.fill(0); im.fill(0);
    let s2 = 0;
    for (let k = 0; k < win; k++) {
      const idx = f * hop - Math.floor(win / 2) + k;
      const v = idx >= 0 && idx < x.length ? x[idx] * hann[k] : 0;
      re[k] = v; s2 += v * v;
    }
    rms[f] = Math.sqrt(s2 / win + 1e-12);
    fft(re, im);
    let e = 1e-12, ec = 0, eh = 0;
    for (let k = 0; k <= N / 2; k++) {
      const fr = (k * sr) / N, p = re[k] * re[k] + im[k] * im[k];
      if (fr > 250 && fr < 3500) { e += p; ec += p * fr; }
      if (fr > 4000 && fr < 9000) eh += p;
    }
    cen[f] = ec / e; hi[f] = eh / (e + eh);
  }
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const p95 = (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0) + 1e-9;
  const cl = (v: number) => Math.max(0, Math.min(1, v));
  const smooth = (a: Float64Array, att: number, rel: number) => { const o = new Float64Array(a.length); let v = 0; a.forEach((s, i) => { v += (s - v) * (s > v ? att : rel); o[i] = v; }); return o; };
  let op = rms.map((r) => cl((r / p95) ** 0.85));
  op = op.map((o, i) => o * (1 - 0.6 * cl((hi[i] - 0.35) / 0.4)));
  let wide = op.map((o, i) => cl((cen[i] - 1150) / 700) * cl(o * 2));
  let rnd = op.map((o, i) => cl((950 - cen[i]) / 450) * cl(o * 2));
  op = smooth(op, 0.65, 0.35); wide = smooth(wide, 0.5, 0.3); rnd = smooth(rnd, 0.5, 0.3);
  const env = smooth(rms.map((r) => r / p95), 0.4, 0.15);
  let emph = env.map((v, i) => cl((v - (i ? env[i - 1] : 0)) * 6));
  emph = smooth(emph, 0.6, 0.12);
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { out[i * 4] = op[i] * 255; out[i * 4 + 1] = wide[i] * 255; out[i * 4 + 2] = rnd[i] * 255; out[i * 4 + 3] = emph[i] * 255; }
  return out;
}

/** Mouth openness 0..1 at time t (seconds into the clip) from a lip track. */
export function lipOpenAt(track: Uint8Array, t: number): number {
  const n = track.length / 4, f = t * LIPS_FPS, i = Math.floor(f), k = f - i;
  if (i < 0 || i >= n) return 0;
  const a = track[i * 4] / 255, b = track[Math.min(n - 1, i + 1) * 4] / 255;
  return a + (b - a) * k;
}
