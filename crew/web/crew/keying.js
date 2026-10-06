// Chroma key on RGBA pixels: no DOM, so it is unit-tested in Node and used by the live viewer and the renderer alike.
// The key is judged in chroma (Cb, Cr) so that shadows and highlights on the screen are keyed as well as its flat colour.

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / Math.max(1e-6, b - a)); return t * t * (3 - 2 * t); };

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return [0, 255, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** BT.601 chroma, 0..255 centred on 128. */
export const chroma = (r, g, b) => [128 + (-0.168736 * r - 0.331264 * g + 0.5 * b), 128 + (0.5 * r - 0.418688 * g - 0.081312 * b)];

export const KEY_DEFAULTS = { on: false, color: "#00ff00", tol: 0.32, soft: 0.18, spill: 0.6 };

/**
 * Keys `data` (a Uint8ClampedArray of RGBA) in place.
 *   tol    0..1  how far from the key colour still counts as screen (0.3 is a good start for an even green screen)
 *   soft   0..1  width of the soft edge beyond tol
 *   spill  0..1  how much key-colour reflection to pull out of the pixels that stay
 */
export function keyPixels(data, key = {}) {
  const k = { ...KEY_DEFAULTS, ...key };
  const [kr, kg, kb] = hexToRgb(k.color), [kcb, kcr] = chroma(kr, kg, kb);
  const reach = 181; // the largest possible chroma distance, so tol and soft are fractions of it
  const t0 = k.tol * reach, t1 = (k.tol + k.soft) * reach;
  const greenish = kg >= kr && kg >= kb, blueish = !greenish && kb >= kr && kb >= kg;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], mx = Math.max(r, g, b);
    // judge the colour at full brightness, so a shadowed part of the screen keys like a lit one; near-black is left alone
    const [cb, cr] = mx < 24 ? [128, 128] : chroma((r * 255) / mx, (g * 255) / mx, (b * 255) / mx);
    const d = Math.hypot(cb - kcb, cr - kcr);
    const a = smooth(t0, t1, d);
    data[i + 3] = Math.round(data[i + 3] * a);
    if (k.spill > 0 && a > 0) {
      // spill: clamp the key channel down to the average of the other two, scaled by the setting
      if (greenish) { const lim = (r + b) / 2; if (g > lim) data[i + 1] = Math.round(g - (g - lim) * k.spill); }
      else if (blueish) { const lim = (r + g) / 2; if (b > lim) data[i + 2] = Math.round(b - (b - lim) * k.spill); }
    }
  }
  return data;
}

/** Fraction of pixels left visible, for the "is the key working" read-out. */
export function keptShare(data) {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) n += data[i] / 255;
  return n / (data.length / 4);
}

/** The most likely screen colour in an image: the most common hue bucket that is strongly green or blue. */
export function guessScreen(data) {
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i], g = data[i + 1], b = data[i + 2], max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max < 60 || (max - min) / max < 0.45) continue;
    const kind = g === max && g - Math.max(r, b) > 40 ? "g" : b === max && b - Math.max(r, g) > 40 ? "b" : null;
    if (!kind) continue;
    const e = buckets.get(kind) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    buckets.set(kind, e);
  }
  let best = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  if (!best || best.n < data.length / 16 / 12) return null; // under about 8% of the frame
  const h = (v) => Math.round(v / best.n).toString(16).padStart(2, "0");
  return `#${h(best.r)}${h(best.g)}${h(best.b)}`;
}
