// Browser-side helpers shared by the export modules.
import { eulerZXY, toBlenderPos, toBlenderQuat, focalFromFov } from "./pure.js";
export * from "./pure.js";

const X = () => window.__crew;
export const toast = (t, k = "info") => X().toast(t, k);
export const server = () => X().store.get().server;
export const baked = () => {
  const b = server()?.baked;
  if (!b) throw new Error("Nothing is loaded yet.");
  return b;
};
export const projectName = () => (server()?.title ?? "crew").replace(/\s+/g, "_");
export const episodeName = () => (server()?.episode ?? "ep").replace(/\.scene$/, "");

export function download(name, data, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

export const shotsOf = (b, ids) => (ids && ids !== "all" ? b.shots.filter((s) => s.id === ids) : b.shots);

/** Open the browser print dialog on a self-contained HTML document. */
export function printHtml(html) {
  const w = window.open("", "_blank");
  if (!w) throw new Error("The browser blocked the print window. Allow pop-ups for this page.");
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.onload = () => setTimeout(() => w.print(), 300);
  setTimeout(() => { try { w.print(); } catch {} }, 1500);
}
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Wait a tick so the UI can paint a progress toast between heavy steps. */
export const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * The camera for every frame of the chosen shots, taken from the viewer's own solver so manual
 * framing (and the camera the director sees) matches exactly.
 * -> { fps, frames: [{ n, shot, pos: [x,y,z], quat: [x,y,z,w], fov }] }  (n counts from 1 across the cut)
 */
export function camFrames(b, shots, { framing = true } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2;
  const v = new (X().Viewer)(canvas);
  v.ignoreFraming = !framing;
  const out = [];
  try {
    for (const s of shots) {
      const len = Math.max(1, Math.round(s.cutDur * b.fps));
      const base = Math.round(s.cutStart * b.fps);
      for (let o = 0; o < len; o++) {
        const f = s.cam?.[Math.min((s.cam?.length ?? 1) - 1, o)] ?? [0, 1.6, 6, 0, 1, 0, 40];
        v.applyCamera(s.id, f, o, Math.max(1, len - 1));
        v.cam.updateMatrixWorld(true);
        const q = v.cam.quaternion;
        out.push({ n: base + o + 1, shot: s.id, pos: [v.cam.position.x, v.cam.position.y, v.cam.position.z], quat: [q.x, q.y, q.z, q.w], fov: v.cam.fov });
      }
    }
  } finally { v.dispose(true); }
  return { fps: b.fps, frames: out };
}
export { eulerZXY, toBlenderPos, toBlenderQuat, focalFromFov };
