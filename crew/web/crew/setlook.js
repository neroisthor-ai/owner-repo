// Set look: a user-chosen look for a project's set, either a 3D room tinted by inspiration images
// or a flat 2D backdrop. The analysis half is DOM-free (unit-tested in Node); reading files and the
// localStorage store are browser-only and guarded. shell.js reads E.setLook.get(projectKey) when it builds a shell.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const h2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
export const toHex = (r, g, b) => `#${h2(r)}${h2(g)}${h2(b)}`;
export const fromHex = (hex) => { const n = parseInt(String(hex).replace("#", "").slice(0, 6), 16) || 0; return [n >> 16, (n >> 8) & 255, n & 255]; };
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const sat = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
const lighten = ([r, g, b], k) => [r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k];

/** Box-average downsample of an RGBA buffer to at most `max` px on the long side: a flat list of [r,g,b] rows. */
function sample(rgba, w, h, max = 48) {
  const s = Math.max(1, Math.ceil(Math.max(w, h) / max)), ow = Math.max(1, Math.floor(w / s)), oh = Math.max(1, Math.floor(h / s));
  const px = new Array(ow * oh);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = y * s; yy < Math.min(h, y * s + s); yy++) for (let xx = x * s; xx < Math.min(w, x * s + s); xx++) { const i = (yy * w + xx) * 4; r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; n++; }
    px[y * ow + x] = [r / n, g / n, b / n];
  }
  return { px, w: ow, h: oh };
}

/** Median cut into k colours, sorted by share. */
function medianCut(px, k) {
  let boxes = [px.slice()];
  while (boxes.length < k) {
    let bi = -1, best = 0, ch = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) { let mn = 255, mx = 0; for (const p of b) { mn = Math.min(mn, p[c]); mx = Math.max(mx, p[c]); } if ((mx - mn) * Math.sqrt(b.length) > best) { best = (mx - mn) * Math.sqrt(b.length); bi = i; ch = c; } }
    });
    if (bi < 0 || best === 0) break;
    const b = boxes[bi].slice().sort((p, q) => p[ch] - q[ch] || p[0] - q[0] || p[1] - q[1] || p[2] - q[2]), m = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, m), b.slice(m));
  }
  const out = boxes.map((b) => { const m = [0, 1, 2].map((c) => b.reduce((s, p) => s + p[c], 0) / b.length); return { hex: toHex(...m), share: b.length / px.length }; });
  out.sort((a, b) => b.share - a.share || (a.hex < b.hex ? -1 : 1));
  return out;
}

/** The most common colour (8 levels per channel), as the mean of the winning bucket; null if there is nothing. */
function dominant(px) {
  const m = new Map();
  for (const p of px) { const k = ((p[0] >> 5) << 6) | ((p[1] >> 5) << 3) | (p[2] >> 5), e = m.get(k) ?? [0, 0, 0, 0]; e[0] += p[0]; e[1] += p[1]; e[2] += p[2]; e[3]++; m.set(k, e); }
  let best = null, bk = -1;
  for (const [k, e] of m) if (!best || e[3] > best[3] || (e[3] === best[3] && k < bk)) { best = e; bk = k; }
  return best ? [best[0] / best[3], best[1] / best[3], best[2] / best[3]] : null;
}
const meanOf = (px) => { const n = px.length || 1; return [0, 1, 2].map((c) => px.reduce((s, p) => s + p[c], 0) / n); };

function guessStyle({ sky, wall, floor, brightness, warmth, contrast, grassy }) {
  if (sky) return grassy ? "park" : "street";
  const [wr, wg, wb] = wall, ws = sat(wr, wg, wb), wl = lum(wr, wg, wb) / 255;
  if (brightness < 0.3 && warmth > 0) return "library";
  if (ws > 0.45 && wr > wg * 1.25 && wr > wb * 1.25) return "cafe";
  if (wg > wr + 6 && wg > wb + 6 && wl > 0.5) return "classroom";
  if (brightness > 0.65 && warmth < 0.06 && ws < 0.12) return contrast < 0.18 ? "office" : "kitchen";
  if (brightness > 0.6 && warmth > 0.1) return "kitchen";
  if (contrast < 0.14 && ws < 0.2) return "corridor";
  if (warmth > 0.1 && floor[0] > floor[2] * 1.2) return "living";
  if (warmth < -0.05) return "office";
  return "room";
}

/**
 * Describe one image: palette, wall/floor/ceiling colours, warmth, brightness, contrast, sky, mood,
 * the closest shell style and a light colour and level. Pure and deterministic.
 */
export function analyseImage(rgba, w, h) {
  const { px, w: sw, h: sh } = sample(rgba, w, h, 48);
  const row = (y0, y1) => px.slice(Math.floor(y0 * sh) * sw, Math.max(Math.floor(y0 * sh) + 1, Math.floor(y1 * sh)) * sw);
  const top = row(0, 0.25), mid = row(0.33, 0.66), bot = row(0.66, 1);
  const palette = medianCut(px, 5).map((e) => e.hex);
  while (palette.length < 5) palette.push(palette[palette.length - 1] ?? "#808080");
  const mean = meanOf(px), lums = px.map((p) => lum(...p));
  const brightness = clamp(lums.reduce((a, b) => a + b, 0) / lums.length / 255, 0, 1);
  const sd = Math.sqrt(lums.reduce((a, b) => a + (b - brightness * 255) ** 2, 0) / lums.length);
  const contrast = clamp(sd / 90, 0, 1);
  const warmth = clamp(((mean[0] - mean[2]) / 255) * 2.2, -1, 1);
  const midTone = mid.filter((p) => { const l = lum(...p); return l > 50 && l < 215; });
  const wall = dominant(midTone.length ? midTone : mid) ?? mean;
  const floor = dominant(bot) ?? mean;
  const ceiling = lighten(dominant(top) ?? mean, 0.35);
  const blueTop = top.filter((p) => p[2] > p[0] + 12 && p[2] >= p[1] - 6 && lum(...p) > 110).length / (top.length || 1);
  const sky = blueTop > 0.5 || (blueTop > 0.3 && lum(...meanOf(top)) > 190 && lum(...meanOf(bot)) < lum(...meanOf(top)) - 20);
  const grassy = floor[1] > floor[0] + 8 && floor[1] > floor[2] + 8;
  const suggestStyle = guessStyle({ sky, wall, floor, brightness, warmth, contrast, grassy });
  const p90 = [...lums].sort((a, b) => a - b)[Math.floor(lums.length * 0.9)] / 255;
  const mx = Math.max(...mean, 1), tint = mean.map((v) => (v / mx) * 255).map((v) => v + (255 - v) * 0.5);
  return {
    palette, wall: toHex(...wall), floor: toHex(...floor), ceiling: toHex(...ceiling),
    warmth, brightness, contrast, sky,
    mood: warmth > 0.12 ? "warm" : warmth < -0.12 ? "cool" : "neutral",
    suggestStyle, lightTint: toHex(...tint), lightLevel: clamp(0.6 * brightness + 0.4 * p90, 0, 1),
  };
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const avgHex = (hs) => { const c = hs.map(fromHex); return toHex(avg(c.map((p) => p[0])), avg(c.map((p) => p[1])), avg(c.map((p) => p[2]))); };

/** Combine several analyses into one look: averaged numbers and colours, palette union, majority style. */
export function mergeLooks(list) {
  const L = (list ?? []).filter(Boolean);
  if (!L.length) return null;
  const pal = [];
  for (const l of L) l.palette.forEach((hex, i) => { const c = fromHex(hex), w = (5 - i) / L.length; const hit = pal.find((p) => Math.hypot(p.c[0] - c[0], p.c[1] - c[1], p.c[2] - c[2]) < 40); if (hit) hit.w += w; else pal.push({ hex, c, w }); });
  pal.sort((a, b) => b.w - a.w);
  const palette = pal.slice(0, 5).map((p) => p.hex);
  while (palette.length < 5) palette.push(palette[palette.length - 1]);
  const votes = new Map(); L.forEach((l) => votes.set(l.suggestStyle, (votes.get(l.suggestStyle) ?? 0) + 1));
  let suggestStyle = L[0].suggestStyle, top = 0;
  for (const l of L) if (votes.get(l.suggestStyle) > top) { top = votes.get(l.suggestStyle); suggestStyle = l.suggestStyle; }
  const warmth = avg(L.map((l) => l.warmth));
  return {
    palette, wall: avgHex(L.map((l) => l.wall)), floor: avgHex(L.map((l) => l.floor)), ceiling: avgHex(L.map((l) => l.ceiling)),
    warmth, brightness: avg(L.map((l) => l.brightness)), contrast: avg(L.map((l) => l.contrast)),
    sky: L.filter((l) => l.sky).length * 2 > L.length,
    mood: warmth > 0.12 ? "warm" : warmth < -0.12 ? "cool" : "neutral",
    suggestStyle, lightTint: avgHex(L.map((l) => l.lightTint)), lightLevel: avg(L.map((l) => l.lightLevel)),
  };
}

// ---- browser only -------------------------------------------------------------------------------------

async function decode(file, max, type, q) {
  const bmp = await createImageBitmap(file), s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true }); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return { c, g, w, h, url: () => c.toDataURL(type, q) };
}

/** Decode image Files at <= 96 px: [{ look, thumb }] (browser only; unreadable files are skipped). */
export async function readImages(files) {
  const out = [];
  for (const f of Array.from(files ?? [])) {
    try { const d = await decode(f, 96, "image/jpeg", 0.7); out.push({ look: analyseImage(d.g.getImageData(0, 0, d.w, d.h).data, d.w, d.h), thumb: d.url() }); }
    catch (e) { console.warn("[crew] set look: could not read an image", e); }
  }
  return out;
}

/** A File downsized to at most 1600 px wide as a JPEG (0.85) data URL, for 2D backdrops (browser only). */
export async function makeBackdrop(file) {
  const bmp = await createImageBitmap(file), s = Math.min(1, 1600 / bmp.width);
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  return c.toDataURL("image/jpeg", 0.85);
}

const KEY = "crew.setlook.v1";
const mem = {};
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return { ...mem }; } };
const save = (all) => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* quota or blocked: the in-memory copy still works this session */ } };

const E = typeof window !== "undefined" ? (window.CrewExt = window.CrewExt ?? {}) : null;
const notify = () => { try { E?.setLookHooks?.forEach((f) => { try { f(); } catch (e) { console.warn("[crew] set look hook", e); } }); window.dispatchEvent?.(new Event("crew:setlook")); } catch { /* ignore */ } };

/** Per-project store. projectKey is `${server.title}|${server.episode}`. */
export const setLook = {
  get(projectKey) { return mem[projectKey] ?? load()[projectKey] ?? null; },
  set(projectKey, v) {
    const rec = { mode: v?.mode === "2d" ? "2d" : "3d", look: v?.look ?? null, thumbs: v?.thumbs ?? [], backdrop: v?.mode === "2d" ? v?.backdrop ?? null : null };
    mem[projectKey] = rec;
    const all = { ...load(), [projectKey]: rec };
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { // too big: keep only this project's record
      save({ [projectKey]: rec });
    }
    notify();
    return rec;
  },
  clear(projectKey) { delete mem[projectKey]; const all = load(); delete all[projectKey]; save(all); notify(); },
};

if (E) {
  E.setLook = setLook;
  E.setLookHooks = E.setLookHooks ?? [];
  E.setLookChanged = notify;
  Object.assign(E, { readImages, makeBackdrop, analyseImage, mergeLooks });
}
