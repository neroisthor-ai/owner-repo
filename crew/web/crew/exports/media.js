// Frames, captions, chapters, image sequences with transparency, and every social size.
import { baked, server, download, toast, tick, srt, chapters, zipStore, projectName, episodeName } from "./util.js";
import * as Reframe from "../render/reframe.js";

const E = window.CrewExt;
const X = () => window.__crew;
const base = () => `${projectName()}_${episodeName()}`;

export const SIZES = {
  yt: { label: "YouTube", w: 1920, h: 1080 },
  short: { label: "Shorts", w: 1080, h: 1920 },
  sq: { label: "Square", w: 1080, h: 1080 },
  feed: { label: "Feed", w: 1080, h: 1350 },
};

// ---- captions and chapters -----------------------------------------------------------------------

E.on("SRT export", () => {
  const b = baked();
  const ev = b.audio.filter((a) => a.type === "say" && a.text).map((a) => ({ t: a.t, dur: a.dur, text: a.text }));
  if (!ev.length) throw new Error("There's no dialogue to caption.");
  download(`${base()}.srt`, srt(ev), "application/x-subrip");
  toast(`Captions: ${ev.length} lines.`);
});

E.on("Chapter list export", () => {
  const b = baked(), seen = new Map();
  for (const s of b.shots) if (!seen.has(s.scene)) seen.set(s.scene, { t: s.cutStart, title: `Scene ${s.scene} · ${s.set}` });
  const { text, warnings } = chapters([...seen.values()]);
  download(`${base()}_chapters.txt`, text, "text/plain");
  toast(`YouTube chapters: ${seen.size}.${warnings.length ? " " + warnings[0] : ""}`, warnings.length ? "info" : "ok");
});

// ---- frames ---------------------------------------------------------------------------------------

/** A viewer for stills: one viewer for many frames (building one per frame is what makes naive exports slow). */
export async function stillViewer(w, h, { look = true, spp = 1, bg = "scene", reframe = null } = {}) {
  const b = baked(), canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const v = new (X().Viewer)(canvas);
  v.assets = server().assets ?? null;
  v.setFixedSize([w, h]);
  v.load(b);
  await v.ready();
  v.lookOn = look && bg === "scene"; v.lookSpp = spp;
  Reframe.setup(v, w, h);
  v._rf = {}; v._reframe = reframe;
  return v;
}

/** Draw frame t of a stills viewer into a 2D canvas (with the matte or green screen if asked). */
export function drawFrame(v, t, bg = "scene") {
  const b = v.baked, w = v.canvas.width, h = v.canvas.height;
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const g = out.getContext("2d", { willReadFrequently: true });
  const shoot = () => { if (v.crop) Reframe.follow(v, b, t, v._reframe, w, v._rf); v.frame(t); };
  if (bg === "alpha") {
    // difference matte: the same frame on black and on white; alpha is how much the white shows through
    v.noSets = true; v.lookOn = false;
    v.bgOverride = "#000000"; shoot(); g.drawImage(v.canvas, 0, 0); const A = g.getImageData(0, 0, w, h);
    v.bgOverride = "#ffffff"; shoot(); g.drawImage(v.canvas, 0, 0); const B = g.getImageData(0, 0, w, h);
    const o = g.createImageData(w, h);
    for (let i = 0; i < A.data.length; i += 4) {
      const d = ((B.data[i] - A.data[i]) + (B.data[i + 1] - A.data[i + 1]) + (B.data[i + 2] - A.data[i + 2])) / 3;
      const a = Math.min(1, Math.max(0, 1 - d / 255));
      o.data[i + 3] = Math.round(a * 255);
      if (a > 0.004) { o.data[i] = Math.min(255, A.data[i] / a); o.data[i + 1] = Math.min(255, A.data[i + 1] / a); o.data[i + 2] = Math.min(255, A.data[i + 2] / a); }
    }
    g.putImageData(o, 0, 0);
    v.noSets = false; v.bgOverride = null;
  } else if (bg === "green") {
    v.noSets = true; v.lookOn = false; v.bgOverride = "#00ff00"; shoot(); g.drawImage(v.canvas, 0, 0);
    v.noSets = false; v.bgOverride = null;
  } else if (bg === "blur") {
    // the set blurred behind sharp characters
    v.lookOn = false; shoot(); g.filter = `blur(${Math.round(h / 60)}px)`; g.drawImage(v.canvas, 0, 0); g.filter = "none";
    const top = document.createElement("canvas"); top.width = w; top.height = h;
    const tg = top.getContext("2d", { willReadFrequently: true });
    v.noSets = true; v.bgOverride = "#000000"; shoot(); tg.drawImage(v.canvas, 0, 0); const A = tg.getImageData(0, 0, w, h);
    v.bgOverride = "#ffffff"; shoot(); tg.drawImage(v.canvas, 0, 0); const B = tg.getImageData(0, 0, w, h);
    const o = tg.createImageData(w, h);
    for (let i = 0; i < A.data.length; i += 4) {
      const d = ((B.data[i] - A.data[i]) + (B.data[i + 1] - A.data[i + 1]) + (B.data[i + 2] - A.data[i + 2])) / 3, a = Math.min(1, Math.max(0, 1 - d / 255));
      o.data[i + 3] = Math.round(a * 255);
      if (a > 0.004) { o.data[i] = Math.min(255, A.data[i] / a); o.data[i + 1] = Math.min(255, A.data[i + 1] / a); o.data[i + 2] = Math.min(255, A.data[i + 2] / a); }
    }
    tg.putImageData(o, 0, 0); g.drawImage(top, 0, 0);
    v.noSets = false; v.bgOverride = null;
  } else { shoot(); g.drawImage(v.canvas, 0, 0); }
  E.overlay?.(g, w, h, t, b, {});
  return out;
}

export const toBlob = (c) => new Promise((ok, fail) => c.toBlob((x) => (x ? ok(x) : fail(new Error("Could not capture the frame."))), "image/png"));

E.on("Frame export", async () => {
  const b = baked(), t = Math.min(X().clock.t, Math.max(0, b.duration - 1e-3));
  const v = await stillViewer(1920, 1080, { look: true, spp: 4 });
  try {
    const blob = await toBlob(drawFrame(v, t));
    download(`${base()}_${t.toFixed(2)}s.png`, blob);
    toast("Frame saved (1920 × 1080, with the film look).");
  } finally { v.dispose(true); }
});

// ---- image sequence, and the formats a browser can't write ------------------------------------------

E.on("PNG sequence export", async ({ background = "scene" }) => {
  const b = baked(), fps = b.fps, n = Math.round(b.duration * fps), W = 1280, H = 720;
  const mb = Math.round((n * W * H * 4 * 0.35) / 1048576);
  if (n > 240 && !window.confirm(`${n} frames at ${W} × ${H} is a zip of roughly ${mb} MB, built in memory. Continue?`)) return;
  const v = await stillViewer(W, H, { look: background === "scene", spp: 1, bg: background });
  const files = [];
  try {
    for (let f = 0; f < n; f++) {
      if (f % 6 === 0) { toast(`PNG frame ${f + 1} of ${n}...`); await tick(); }
      const blob = await toBlob(drawFrame(v, Math.min(f / fps, b.duration - 1e-4), background));
      files.push({ name: `${base()}_${String(f + 1).padStart(5, "0")}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
    }
  } finally { v.dispose(true); }
  download(`${base()}_frames_${background}.zip`, new Blob([zipStore(files)], { type: "application/zip" }));
  toast(`${n} PNG frames at ${fps} fps${background === "alpha" ? ", with transparency (characters only)" : ""}. Drop them on a timeline as an image sequence.`);
});

E.on("WebM alpha export", () => {
  toast("WebM with transparency needs a WebM muxer, and this app only has an MP4 one. Use the PNG sequence with 'Transparent (characters only)': every editor reads it, alpha included.");
});
E.on("Transparent ProRes export", () => {
  toast("The browser can't write ProRes. Use the PNG sequence with 'Transparent (characters only)'; Premiere, Resolve, After Effects and Final Cut all import it with alpha.");
});

// ---- every size -----------------------------------------------------------------------------------

E.on("Rendering every size", async ({ sizes = {} }) => {
  const b = baked(), picked = Object.entries(SIZES).filter(([k]) => sizes[k]);
  if (!picked.length) throw new Error("Tick at least one size.");
  const files = [];
  for (let i = 0; i < picked.length; i++) {
    const [k, sz] = picked[i];
    const r = await E.renderPart(b, { start: 0, end: b.duration }, { width: sz.w, height: sz.h, fps: b.fps, burn: { timecode: false, shot: false, subs: true }, passes: E.render?.spp ?? 1, reframe: E.reframeCfg }, {
      assets: server().assets,
      onProgress: (d, t) => { if (d % 12 === 0) toast(`${sz.label} ${sz.w}×${sz.h} (${i + 1} of ${picked.length}): ${Math.round((d / t) * 100)}%`); },
    });
    files.push({ name: `${base()}_${k}_${sz.w}x${sz.h}.mp4`, data: new Uint8Array(await r.blob.arrayBuffer()) });
  }
  if (files.length === 1) download(files[0].name, new Blob([files[0].data], { type: "video/mp4" }));
  else download(`${base()}_sizes.zip`, new Blob([zipStore(files)], { type: "application/zip" }));
  toast(`Rendered ${files.length} size${files.length > 1 ? "s" : ""}. Narrower frames follow the subject.`);
});

E.wired("Sizes", "Drop into your video", "Voice and captions", "Length and chapters");
