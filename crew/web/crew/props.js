// Props and sets: turns baked set boxes into library models. The registry at
// /library/props/index.js is loaded by known path only (the library itself is never browsed).
import * as THREE from "/vendor/three/three.module.js";

let registry = null;
try { registry = await import("/library/props/index.js"); } catch (e) { console.warn("[crew] prop registry not loaded; boxes stay plain", e); }

const HUGE = 30; // metres; skies, water and backdrops over this are decor, not furniture

/** A model for one baked box, or null (the viewer then draws its grey cube). */
function buildBox(box) {
  if (!registry || !box?.prop) return null;
  try { const m = registry.buildBox(box, THREE); if (m && box.prop.startsWith("sky_")) m.userData.isSky = true; return m; } catch (e) { console.warn(`[crew] prop ${box.prop} failed`, e); return null; }
}

/** The box list the viewer draws: server boxes plus floor and three walls for indoor sets (the server bake has none). */
function setBoxes(set) {
  const boxes = (set.boxes ?? []).filter((b) => !(b.decor && Math.max(b.w, b.h, b.d) > HUGE && !(registry && b.prop)));
  if (set.open || set.boxes?.some((b) => b.tag === "floor")) return boxes;
  const { w, d, h } = set, t = 0.1;
  return [
    { x: 0, y: -0.05, z: 0, w, h: 0.05, d, tag: "floor", color: "#3b4350", shell: true },
    { x: 0, y: 0, z: -d / 2 + t / 2, w, h, d: t, tag: "back wall", color: "#4a5361", shell: true },
    { x: -w / 2 + t / 2, y: 0, z: 0, w: t, h, d, tag: "left wall", color: "#444c59", shell: true },
    { x: w / 2 - t / 2, y: 0, z: 0, w: t, h, d, tag: "right wall", color: "#444c59", shell: true },
    ...boxes,
  ];
}

Object.assign(window.CrewExt, { buildBox, setBoxes, props: registry?.PROPS ?? null, hasProps: !!registry });
