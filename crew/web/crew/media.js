// The edit layer: your own sounds, pictures and footage on extra tracks of the timeline, with chroma key.
// It sits on top of the cut. The crew still owns the shots (V1) and their dialogue; this layer never changes the scene source.
//   V2, V3  pictures and footage over the cut (keyable)       A3, A4  your own audio under or over the cut
// State lives here, clips persist per project in localStorage, the media files in IndexedDB.
import { keyPixels, KEY_DEFAULTS, guessScreen } from "./keying.js";

const E = window.CrewExt;
const X = () => window.__crew;

export const TRACKS = [
  { id: "V3", kind: "visual", label: "Overlay 2" },
  { id: "V2", kind: "visual", label: "Overlay 1" },
  { id: "A3", kind: "audio", label: "Your audio" },
  { id: "A4", kind: "audio", label: "Your audio 2" },
];
const FPS = () => X()?.store?.get().server?.baked?.fps ?? 24;
const cutLen = () => X()?.store?.get().server?.baked?.duration ?? 0;
const uid = () => Math.random().toString(36).slice(2, 9);
const IMAGE_SECS = 4;

// ---- storage -------------------------------------------------------------------------------------------------------

const db = () => new Promise((res, rej) => {
  const r = indexedDB.open("crew-media", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("items", { keyPath: "id" });
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const idb = async (mode, fn) => { try { const d = await db(); return await new Promise((res, rej) => { const t = d.transaction("items", mode), q = fn(t.objectStore("items")); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); } catch { return null; } };
const projectKey = () => { const s = X()?.store?.get().server; return `crew.edit.v1.${s?.title ?? ""}|${s?.episode ?? ""}`; };
const persist = () => { try { localStorage.setItem(projectKey(), JSON.stringify(ed.clips)); } catch {} };

// ---- the model -----------------------------------------------------------------------------------------------------

/** @type {{ items: Map<string, any>, clips: any[], sel: string|null, rev: number }} */
const ed = { items: new Map(), clips: [], sel: null, rev: 0, undo: [], redo: [], loadedKey: null };
const bump = () => { ed.rev++; X()?.store?.set({ editRev: ed.rev }); redrawAll(); };
const snapshot = () => { ed.undo.push(JSON.stringify(ed.clips)); if (ed.undo.length > 60) ed.undo.shift(); ed.redo.length = 0; ed.lastAt = Date.now(); };
const commit = () => { persist(); bump(); };

const trackKind = (id) => TRACKS.find((t) => t.id === id)?.kind;
const clipEnd = (c) => c.t + c.dur;
const itemOf = (c) => ed.items.get(c.item);
/** What kinds of clips a track takes: pictures and footage go on V tracks, sound on A tracks. */
const fits = (track, item) => (trackKind(track) === "audio" ? item.kind === "audio" || item.kind === "video" : item.kind !== "audio");

async function restore() {
  const key = projectKey();
  if (ed.loadedKey === key) return;
  ed.loadedKey = key;
  try { ed.clips = JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { ed.clips = []; }
  const ids = [...new Set(ed.clips.map((c) => c.item))];
  for (const id of ids) {
    if (ed.items.has(id)) continue;
    const rec = await idb("readonly", (s) => s.get(id));
    if (rec) await hydrate(rec).catch(() => {});
  }
  ed.clips = ed.clips.filter((c) => ed.items.has(c.item)); // media that is gone takes its clips with it
  bump();
}

E.edit = ed;
E.editApi = {
  TRACKS, KEY_DEFAULTS,
  items: () => [...ed.items.values()],
  clips: () => ed.clips,
  clipsOn: (track) => ed.clips.filter((c) => c.track === track),
  itemOf,
  selected: () => ed.clips.find((c) => c.id === ed.sel) ?? null,
  select(id) { ed.sel = id; bump(); },
  canUndo: () => ed.undo.length > 0,
  /** true when the last thing the user did was an edit-layer change, so Undo should step it back */
  undoIsMine: () => ed.undo.length > 0 && (X().store.get().server?.history?.length ?? 0) === (ed.histAt ?? 0),
};

// ---- importing -----------------------------------------------------------------------------------------------------

const kindOf = (f) => (f.type.startsWith("audio/") ? "audio" : f.type.startsWith("video/") ? "video" : f.type.startsWith("image/") ? "image" : /\.(wav|mp3|m4a|ogg|flac|aac)$/i.test(f.name) ? "audio" : /\.(mp4|mov|webm|m4v)$/i.test(f.name) ? "video" : /\.(png|jpe?g|webp|gif|avif)$/i.test(f.name) ? "image" : null);
const audioCtx = () => (E._actx ??= new (window.AudioContext ?? window.webkitAudioContext)());

/** Builds the runtime parts of an item (object URL, decoded audio, thumbnail, size) from its stored blob. */
async function hydrate(rec) {
  const url = URL.createObjectURL(rec.blob);
  const it = { id: rec.id, name: rec.name, kind: rec.kind, blob: rec.blob, url, dur: 0, w: 0, h: 0, buffer: null, thumb: null, el: null };
  if (rec.kind === "image") {
    const img = new Image(); img.src = url; await img.decode();
    Object.assign(it, { w: img.naturalWidth, h: img.naturalHeight, el: img, dur: IMAGE_SECS, thumb: thumbOf(img, img.naturalWidth, img.naturalHeight) });
  } else if (rec.kind === "video") {
    const v = document.createElement("video");
    v.src = url; v.muted = true; v.playsInline = true; v.preload = "auto"; v.crossOrigin = "anonymous";
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error("unreadable video")); });
    Object.assign(it, { w: v.videoWidth, h: v.videoHeight, el: v, dur: v.duration, thumb: thumbOf(v, v.videoWidth, v.videoHeight) });
    try { it.buffer = await audioCtx().decodeAudioData(await rec.blob.arrayBuffer()); } catch { it.buffer = null; } // no sound track is fine
  } else {
    it.buffer = await audioCtx().decodeAudioData(await rec.blob.arrayBuffer());
    it.dur = it.buffer.duration;
  }
  ed.items.set(it.id, it);
  return it;
}
function thumbOf(src, w, h) {
  const c = document.createElement("canvas"), s = 96 / Math.max(w, h, 1);
  c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
  try { c.getContext("2d").drawImage(src, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.7); } catch { return null; }
}

/** Waveform bars for an audio clip's row, as a data URL (cached per item). */
const waves = new Map();
E.editApi.wave = (it) => {
  if (!it.buffer) return null;
  if (waves.has(it.id)) return waves.get(it.id);
  const W = 600, H = 40, c = document.createElement("canvas"), g = c.getContext("2d"), d = it.buffer.getChannelData(0), step = Math.max(1, Math.floor(d.length / W));
  c.width = W; c.height = H; g.fillStyle = "rgba(235,255,245,.9)";
  for (let x = 0; x < W; x++) {
    let m = 0;
    for (let i = x * step; i < Math.min(d.length, (x + 1) * step); i += 8) m = Math.max(m, Math.abs(d[i]));
    const h = Math.max(1, Math.min(1, m * 1.6) * (H - 6));
    g.fillRect(x, (H - h) / 2, 1, h);
  }
  const url = c.toDataURL("image/png");
  waves.set(it.id, url);
  return url;
};

/** Adds files to the project's media and drops each on the timeline at `t` (the playhead by default). Returns the new clips. */
E.editApi.importFiles = async (files, { t, track } = {}) => {
  await restore();
  const out = [];
  let at = t ?? X().clock.t ?? 0;
  for (const f of files) {
    const kind = kindOf(f);
    if (!kind) { X().toast(`"${f.name}" isn't a sound, picture or video this browser can use.`, "error"); continue; }
    try {
      const id = uid();
      await idb("readwrite", (s) => s.put({ id, name: f.name, kind, blob: f }));
      const it = await hydrate({ id, name: f.name, kind, blob: f });
      const clip = E.editApi.addClip(it.id, { t: at, track, quiet: true });
      if (clip) { out.push(clip); at = clipEnd(clip); }
    } catch (e) { X().toast(`Couldn't read "${f.name}": ${e.message}`, "error"); }
  }
  if (out.length) { ed.sel = out[out.length - 1].id; commit(); }
  return out;
};

/** Makes a clip from a recording or other in-memory audio, for the voiceover. */
E.editApi.importBlob = (blob, name, opts) => E.editApi.importFiles([new File([blob], name, { type: blob.type || "audio/webm" })], opts);

// ---- clips ---------------------------------------------------------------------------------------------------------

const firstFree = (track, t, dur, ignore) => {
  // push a clip right until it no longer overlaps another on the same track
  let at = t;
  for (const c of ed.clips.filter((c) => c.track === track && c.id !== ignore).sort((a, b) => a.t - b.t)) if (at < clipEnd(c) - 1e-6 && at + dur > c.t + 1e-6) at = clipEnd(c);
  return at;
};

E.editApi.addClip = (itemId, { t = 0, track, quiet } = {}) => {
  const it = ed.items.get(itemId);
  if (!it) return null;
  track ||= it.kind === "audio" ? "A3" : "V2";
  if (!fits(track, it)) track = it.kind === "audio" ? "A3" : "V2";
  const dur = it.kind === "image" ? IMAGE_SECS : it.dur;
  if (!quiet) snapshot();
  else snapshot();
  const clip = { id: uid(), item: itemId, track, t: firstFree(track, Math.max(0, t), dur), dur, in: 0, gain: 1, fadeIn: 0, fadeOut: 0, mute: false,
    x: 0.5, y: 0.5, scale: 1, opacity: 1, key: { ...KEY_DEFAULTS } };
  ed.clips.push(clip);
  if (!quiet) { ed.sel = clip.id; commit(); }
  return clip;
};

E.editApi.update = (id, patch, { record = true } = {}) => {
  const c = ed.clips.find((c) => c.id === id);
  if (!c) return;
  if (record) snapshot();
  for (const [k, v] of Object.entries(patch)) c[k] = k === "key" ? { ...c.key, ...v } : v;
  commit();
};
/** Live drags call this per move without piling up undo entries; call `begin()` once at the start of the drag. */
E.editApi.begin = () => snapshot();
E.editApi.set = (id, patch) => E.editApi.update(id, patch, { record: false });

E.editApi.remove = (id) => {
  if (!ed.clips.some((c) => c.id === id)) return;
  snapshot();
  ed.clips = ed.clips.filter((c) => c.id !== id);
  if (ed.sel === id) ed.sel = null;
  commit();
};

E.editApi.move = (id, { t, track }) => {
  const c = ed.clips.find((c) => c.id === id);
  if (!c) return;
  const it = itemOf(c);
  if (track && track !== c.track && it && fits(track, it)) c.track = track;
  if (t != null) c.t = Math.max(0, t);
  commit();
};

/** Trims one edge to `time` (cut time). The in-point moves with the left edge so the footage stays where it was. */
E.editApi.trim = (id, edge, time) => {
  const c = ed.clips.find((c) => c.id === id), it = c && itemOf(c);
  if (!c || !it) return;
  const frame = 1 / FPS();
  if (edge === "l") {
    const maxT = clipEnd(c) - frame;
    let t = Math.max(0, Math.min(maxT, time));
    let d = t - c.t;
    if (it.kind !== "image" && c.in + d < 0) { d = -c.in; t = c.t + d; }
    c.in = it.kind === "image" ? 0 : c.in + d; c.t = t; c.dur -= d;
  } else {
    let end = Math.max(c.t + frame, time);
    if (it.kind !== "image") end = Math.min(end, c.t + (it.dur - c.in));
    c.dur = end - c.t;
  }
  commit();
};

E.editApi.split = (id, time) => {
  const c = ed.clips.find((c) => c.id === id);
  if (!c || time <= c.t + 0.05 || time >= clipEnd(c) - 0.05) return null;
  snapshot();
  const right = { ...c, key: { ...c.key }, id: uid(), t: time, in: c.in + (time - c.t), dur: clipEnd(c) - time, fadeIn: 0 };
  c.dur = time - c.t; c.fadeOut = 0;
  ed.clips.push(right);
  ed.sel = right.id;
  commit();
  return right;
};
/** Splits whatever is under the playhead: the selected clip if it is, otherwise every user clip there. */
E.editApi.splitAtPlayhead = () => {
  const t = X().clock.t, sel = E.editApi.selected();
  const hit = sel && t > sel.t && t < clipEnd(sel) ? [sel] : ed.clips.filter((c) => t > c.t && t < clipEnd(c));
  let n = 0;
  for (const c of hit) if (E.editApi.split(c.id, t)) n++;
  return n;
};

E.editApi.duplicate = (id) => {
  const c = ed.clips.find((c) => c.id === id);
  if (!c) return;
  snapshot();
  const d = { ...c, key: { ...c.key }, id: uid(), t: firstFree(c.track, clipEnd(c), c.dur) };
  ed.clips.push(d); ed.sel = d.id; commit();
};

/** The media pool's selection (what the Source monitor shows). */
E.editApi.binSel = () => ed.items.get(ed.binSelId) ?? null;
E.editApi.binSelect = (id) => { ed.binSelId = id; bump(); };
/** Removes a file from the project, and every clip made from it. */
E.editApi.removeItem = async (id) => {
  const it = ed.items.get(id);
  if (!it) return;
  snapshot();
  ed.clips = ed.clips.filter((c) => c.item !== id);
  if (ed.sel && !ed.clips.some((c) => c.id === ed.sel)) ed.sel = null;
  if (ed.binSelId === id) ed.binSelId = null;
  try { URL.revokeObjectURL(it.url); } catch {}
  ed.items.delete(id);
  await idb("readwrite", (s) => s.delete(id));
  commit();
};

E.editApi.undoEdit = () => { const s = ed.undo.pop(); if (s == null) return false; ed.redo.push(JSON.stringify(ed.clips)); ed.clips = JSON.parse(s); commit(); return true; };
E.editApi.redoEdit = () => { const s = ed.redo.pop(); if (s == null) return false; ed.undo.push(JSON.stringify(ed.clips)); ed.clips = JSON.parse(s); commit(); return true; };

/** Snap a time to the playhead, the cuts between shots and the edges of other clips, within `px` screen pixels at `pps` pixels per second. */
E.editApi.snap = (time, { ignore, pps = 60, px = 8 } = {}) => {
  const pts = [X().clock.t, 0, ...(X().store.get().server?.baked?.shots ?? []).flatMap((s) => [s.cutStart, s.cutStart + s.cutDur])];
  for (const c of ed.clips) if (c.id !== ignore) pts.push(c.t, clipEnd(c));
  let best = time, d = px / pps;
  for (const p of pts) if (Math.abs(p - time) < d) { d = Math.abs(p - time); best = p; }
  return best;
};

/** Guesses the screen colour from a clip's first frame and switches the key on. */
E.editApi.autoKey = (id) => {
  const c = ed.clips.find((c) => c.id === id), it = c && itemOf(c);
  if (!it?.el || it.kind === "audio") return null;
  const w = 160, h = Math.max(1, Math.round((160 * it.h) / Math.max(1, it.w))), cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(it.el, 0, 0, w, h);
  const col = guessScreen(g.getImageData(0, 0, w, h).data);
  E.editApi.update(id, { key: col ? { on: true, color: col } : { on: true } });
  return col;
};

// ---- sound: the live player and the render mix ----------------------------------------------------------------------

function connectClip(ctx, dest, c, it, when, offset, len) {
  const s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = it.buffer;
  const vol = c.mute ? 0 : c.gain, t0 = when, t1 = when + len;
  const fi = Math.min(c.fadeIn, len), fo = Math.min(c.fadeOut, len);
  g.gain.setValueAtTime(offset > 0 || fi === 0 ? vol : 0, t0);
  if (fi > 0 && offset === 0) g.gain.linearRampToValueAtTime(vol, t0 + fi);
  if (fo > 0) { g.gain.setValueAtTime(vol, Math.max(t0, t1 - fo)); g.gain.linearRampToValueAtTime(0, t1); }
  s.connect(g); g.connect(dest);
  s.start(t0, c.in + offset, len);
}
const audible = (c) => !!itemOf(c)?.buffer && !c.mute;

E.startUser = (m4, from, when) => {
  const ctx = m4.ctx;
  for (const c of ed.clips) {
    const it = itemOf(c);
    if (!it?.buffer || !audible(c) || clipEnd(c) <= from) continue;
    const off = Math.max(0, from - c.t), len = c.dur - off;
    if (len > 0.02) connectClip(ctx, m4.master, c, it, when + Math.max(0, c.t - from), off, len);
  }
};
E.mixUser = (octx, dest, from, to) => {
  for (const c of ed.clips) {
    const it = itemOf(c);
    if (!it?.buffer || !audible(c) || clipEnd(c) <= from || c.t >= to) continue;
    const off = Math.max(0, from - c.t), len = Math.min(c.dur - off, to - Math.max(c.t, from));
    if (len > 0.02) connectClip(octx, dest, c, it, Math.max(0, c.t - from), off, len);
  }
};

// ---- pictures: drawing the overlay clips (live viewer and renders) ---------------------------------------------------

const scratch = (() => { let c; return (w, h) => { c ??= document.createElement("canvas"); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return c; }; })();

/** Draws every visual clip active at cut time `t` onto `g` (W×H). `keyW` caps the pixel work of keying. */
export function drawClips(g, W, H, t, { keyW = 960 } = {}) {
  const active = ed.clips.filter((c) => c.track[0] === "V" && t >= c.t && t < clipEnd(c)).sort((a, b) => (a.track === b.track ? a.t - b.t : a.track < b.track ? -1 : 1));
  for (const c of active) {
    const it = itemOf(c);
    if (!it?.el || !it.w) continue;
    const fit = Math.min(W / it.w, H / it.h) * c.scale, dw = it.w * fit, dh = it.h * fit, dx = c.x * W - dw / 2, dy = c.y * H - dh / 2;
    let a = c.opacity;
    if (c.fadeIn > 0) a *= Math.min(1, (t - c.t) / c.fadeIn);
    if (c.fadeOut > 0) a *= Math.min(1, (clipEnd(c) - t) / c.fadeOut);
    g.save(); g.globalAlpha = Math.max(0, Math.min(1, a));
    if (c.key?.on) {
      const kw = Math.min(keyW, Math.round(dw)), kh = Math.max(1, Math.round((kw * dh) / dw)), sc = scratch(kw, kh), sg = sc.getContext("2d", { willReadFrequently: true });
      sg.clearRect(0, 0, kw, kh); sg.drawImage(it.el, 0, 0, kw, kh);
      const px = sg.getImageData(0, 0, kw, kh);
      keyPixels(px.data, c.key); sg.putImageData(px, 0, 0);
      g.drawImage(sc, dx, dy, dw, dh);
    } else g.drawImage(it.el, dx, dy, dw, dh);
    g.restore();
  }
}
const sourceTime = (c, t) => c.in + (t - c.t);
const hasVisual = () => ed.clips.some((c) => c.track[0] === "V");

/** Renders: seek each active video to the frame for time `t`, then draw. Called after the 3D frame and the branding. */
E.overlayUser = async (g, W, H, t) => {
  if (!hasVisual()) return;
  const waits = [];
  for (const c of ed.clips) {
    const it = itemOf(c);
    if (c.track[0] !== "V" || it?.kind !== "video" || t < c.t || t >= clipEnd(c)) continue;
    const want = Math.min(it.dur - 0.001, sourceTime(c, t)), v = it.el;
    v.pause();
    if (Math.abs(v.currentTime - want) > 0.0005) waits.push(new Promise((res) => { const done = () => { v.removeEventListener("seeked", done); res(); }; v.addEventListener("seeked", done); v.currentTime = want; setTimeout(done, 1500); }));
  }
  await Promise.all(waits);
  drawClips(g, W, H, t, { keyW: W });
};

// ---- the live viewer: an overlay canvas that follows the clock -----------------------------------------------------

const viewers = new Set();
const redrawAll = () => viewers.forEach((v) => v.draw?.());
let playing = false;

function attach(v) {
  if (v._userOv || !v.canvas?.parentElement) return;
  const c = document.createElement("canvas");
  c.className = "crew-user-overlay";
  c.style.cssText = "position:absolute;pointer-events:none;z-index:3";
  v.canvas.parentElement.appendChild(c);
  const o = { canvas: c };
  o.draw = () => {
    const r = v.canvas, par = r.parentElement;
    // the Source monitor shows takes and footage, not the cut: your overlays belong on the program monitor only
    if (!par || !hasVisual() || /^\s*Source/.test(r.closest("section")?.textContent ?? "")) { if (c.width) { c.width = 0; } return; }
    const br = r.getBoundingClientRect(), pr = par.getBoundingClientRect();
    if (br.width < 2) return;
    const W = Math.min(960, Math.round(br.width)), H = Math.round((W * br.height) / br.width);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    c.style.left = `${br.left - pr.left}px`; c.style.top = `${br.top - pr.top}px`; c.style.width = `${br.width}px`; c.style.height = `${br.height}px`;
    const g = c.getContext("2d");
    g.clearRect(0, 0, W, H);
    const t = X().clock.t;
    syncVideos(t);
    drawClips(g, W, H, t, { keyW: 640 });
  };
  v._userOv = o;
  viewers.add(o);
  o.draw();
}
function syncVideos(t) {
  const want = new Set();
  for (const c of ed.clips) {
    const it = itemOf(c);
    if (c.track[0] !== "V" || it?.kind !== "video") continue;
    const on = t >= c.t && t < clipEnd(c), v = it.el, src = sourceTime(c, t);
    if (on) want.add(it.id);
    if (on && playing) { if (v.paused || Math.abs(v.currentTime - src) > 0.3) { v.currentTime = Math.min(it.dur - 0.01, src); v.play().catch(() => {}); } }
    else { if (!v.paused) v.pause(); if (on && Math.abs(v.currentTime - src) > 0.04) v.currentTime = Math.min(it.dur - 0.01, src); }
  }
}

const wait = setInterval(() => {
  const x = X();
  if (!x?.store || !x.clock) return;
  clearInterval(wait);
  const clock = x.clock;
  let lastKey = null;
  x.store.subscribe(() => { const s = x.store.get(); if (s.server && projectKey() !== lastKey) { lastKey = projectKey(); restore(); } if (!ed.histSeen || s.server?.history?.length !== ed.histAt) { ed.histAt = s.server?.history?.length ?? 0; ed.histSeen = true; } });
  // keep the overlays in step with the playhead; a seeked video needs a moment, so redraw on its event as well
  clock.subscribe(() => { playing = clock.playing; redrawAll(); });
  const tickWhilePlaying = () => { if (playing) redrawAll(); requestAnimationFrame(tickWhilePlaying); };
  tickWhilePlaying();
}, 100);

E.viewerHooks.push((v, what) => {
  if (what === "gone") { v._gone = true; if (v._userOv) { v._userOv.canvas.remove(); viewers.delete(v._userOv); v._userOv = null; } return; }
  let tries = 0; // the canvas is mounted just after the viewer is made
  const go = () => { if (v._gone) return; if (v.canvas?.parentElement) attach(v); else if (tries++ < 60) requestAnimationFrame(go); };
  go();
});

export { restore as restoreEdit };
