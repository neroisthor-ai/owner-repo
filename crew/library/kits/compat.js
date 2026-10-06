// Compatibility layer for running code written against older three.js (r128 Low Pass,
// r147 The Bob) on current three.js, without changing how it looks.
//
// - THREE: the current namespace plus the old names those films used
//   (DataTexture3D, FullScreenQuad, UnrealBloomPass, FXAAShader, encodings).
// - legacy(fn): runs fn with colour management off, so hex colours mean what
//   they meant before r152 (raw values) and convertSRGBToLinear() is not doubled.
// - legacyRender(): r128's non-physical lights were pi times brighter; this
//   renders a scene with intensities compensated, then restores them.
// - inert(): a stand-in DOM element so film UI code runs as a no-op.
import * as CORE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { CopyShader } from "three/addons/shaders/CopyShader.js";
import { LuminosityHighPassShader } from "three/addons/shaders/LuminosityHighPassShader.js";

export const THREE = Object.freeze({
  ...CORE,
  FullScreenQuad, UnrealBloomPass, EffectComposer, FXAAShader, CopyShader, LuminosityHighPassShader,
  DataTexture3D: CORE.Data3DTexture,
  LinearEncoding: 3000,
  sRGBEncoding: 3001,
});

export function legacy(fn) {
  const was = CORE.ColorManagement.enabled;
  CORE.ColorManagement.enabled = false;
  try { return fn(); } finally { CORE.ColorManagement.enabled = was; }
}

/** Wrap every function on an object so it runs under legacy colour rules. Async results are awaited inside. */
export function legacyAll(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "function" || /^[A-Z]/.test(k)) { Object.defineProperty(out, k, Object.getOwnPropertyDescriptor(obj, k)); continue; }
    out[k] = (...a) => legacy(() => v(...a));
  }
  return out;
}

const PI_LIGHTS = new WeakMap();
/** Render with r128-style (non-physical) light intensities. */
export function legacyRender(renderer, scene, camera) {
  let L = PI_LIGHTS.get(scene);
  if (!L || L.dirty) {
    L = { list: [] };
    scene.traverse((o) => { if (o.isLight) L.list.push(o); });
    PI_LIGHTS.set(scene, L);
  }
  const saved = L.list.map((l) => l.intensity);
  for (const l of L.list) l.intensity *= Math.PI;
  try { renderer.render(scene, camera); } finally { L.list.forEach((l, i) => { l.intensity = saved[i]; }); }
}
/** Call when lights are added to a scene after its first legacyRender. */
export function lightsChanged(scene) { const L = PI_LIGHTS.get(scene); if (L) L.dirty = true; }

/** An element that accepts any property read, write or call and does nothing. */
export function inert() {
  const fn = function () { return p; };
  const p = new Proxy(fn, {
    get(_t, k) {
      if (k === Symbol.toPrimitive) return () => "";
      if (k === "getBoundingClientRect") return () => ({ x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });
      if (k === "querySelector") return () => p;
      if (k === "querySelectorAll") return () => [];
      if (k === "style" || k === "dataset" || k === "classList" || k === "firstElementChild" || k === "parentNode") return p;
      if (k === "value" || k === "textContent" || k === "innerHTML") return "";
      if (k === "hidden" || k === "disabled") return false;
      if (k === "offsetHeight" || k === "offsetWidth" || k === "clientWidth" || k === "clientHeight") return 0;
      if (k === "then") return undefined;
      return p;
    },
    set() { return true; },
    apply() { return p; },
  });
  return p;
}

/** A $/getElementById replacement: real elements for the ids the kit needs, inert for the film's UI. */
export function domMap(real) {
  const cache = new Map();
  return (sel) => {
    const id = String(sel).replace(/^#/, "");
    if (real[id]) return real[id];
    if (!cache.has(id)) cache.set(id, inert());
    return cache.get(id);
  };
}

export const ASSET_ROOT = "/library";
