// Reframing for other aspect ratios: render the shot with its own 16:9 camera and cut a window out of
// it that follows the subject (a vertical 9:16 for Shorts, a square, a 4:5 feed crop). The window uses
// the camera's view offset, so the crop is exact and costs nothing extra.
import { infoAt } from "./look.js";

const WIDE = 16 / 9;

/** Turn a viewer into a cropped one for a W x H output. Returns false when the output is already 16:9 or wider. */
export function setup(viewer, W, H) {
  if (W / H >= WIDE - 0.01) { viewer.cropAspect = null; viewer.crop = null; return false; }
  viewer.cropAspect = WIDE;
  const fw = Math.round(H * WIDE);
  viewer.crop = { fw, fh: H, x: Math.round((fw - W) / 2), y: 0 };
  return true;
}

export function clear(viewer) { viewer.cropAspect = null; viewer.crop = null; }

/**
 * Move the window for time t. cfg = { mode: "auto" | "manual", crop: -0.34..0.34 (manual: share of the frame width) }.
 * `state` carries the smoothed position between frames, so call with the same object for a whole render.
 */
export function follow(viewer, baked, t, cfg, W, state) {
  const c = viewer.crop;
  if (!c) return;
  const info = infoAt(baked, t), shot = info.shot, V3 = window.__crew.three.Vector3;
  const maxX = c.fw - W;
  let target = maxX / 2;
  if (cfg?.mode === "manual") target = maxX / 2 + (cfg.crop ?? 0) * c.fw;
  else {
    viewer._noDraw = true; viewer.frame(t); viewer._noDraw = false;
    const cam = viewer.cam;
    cam.updateMatrixWorld();
    // the subject: the shot's first visible subject, else any visible character
    let rig = null;
    for (const id of shot.subjects ?? []) { const r = viewer.rigs.get(id); if (r?.group.visible) { rig = r; break; } }
    if (!rig) for (const [, r] of viewer.rigs) if (r.group.visible) { rig = r; break; }
    if (rig) {
      const p = new V3(rig.group.position.x, (rig.height || 1.7) * 0.85, rig.group.position.z).project(cam);
      target = (p.x * 0.5 + 0.5) * c.fw - W / 2;
    }
  }
  target = Math.min(maxX, Math.max(0, target));
  if (state.shot !== shot.id || state.x == null) { state.x = target; state.shot = shot.id; }
  else state.x += (target - state.x) * 0.12; // ease: the window glides after the subject rather than snapping to it
  c.x = Math.round(Math.min(maxX, Math.max(0, state.x)));
}
