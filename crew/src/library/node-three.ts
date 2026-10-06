// three.js in Node: just enough of the browser for geometry building, raycasting
// and GLTFExporter/GLTFLoader to run headless (import tooling + tests).

import * as THREE from "three";

const g = globalThis as Record<string, unknown>;
if (!g.FileReader) {
  g.FileReader = class {
    result: unknown = null;
    onloadend: (() => void) | null = null;
    onload: (() => void) | null = null;
    readAsArrayBuffer(b: Blob) { void b.arrayBuffer().then((a) => { this.result = a; this.onload?.(); this.onloadend?.(); }); }
    readAsDataURL(b: Blob) {
      void b.arrayBuffer().then((a) => { this.result = `data:${b.type || "application/octet-stream"};base64,${Buffer.from(a).toString("base64")}`; this.onload?.(); this.onloadend?.(); });
    }
  };
}

/** Minimal 2D canvas stand-in: drawing calls are accepted and ignored. Lets canvas-texture code run in Node. */
export function installCanvasShim() {
  if (g.document) return;
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === "getImageData") return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (k === "createImageData") return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "createRadialGradient" || k === "createLinearGradient" || k === "createPattern") return () => ({ addColorStop() { /* noop */ } });
      return () => { /* noop */ };
    },
    set: () => true,
  });
  const canvas = () => ({ width: 1, height: 1, style: {}, getContext: () => ctx, addEventListener() { /* noop */ }, toDataURL: () => "" });
  g.document = { createElement: (t: string) => (t === "canvas" ? canvas() : { style: {} }), createElementNS: () => canvas() };
  g.OffscreenCanvas ??= class { width: number; height: number; constructor(w: number, h: number) { this.width = w; this.height = h; } getContext() { return ctx; } };
}

export { THREE };

export async function exportGLB(obj: THREE.Object3D): Promise<Buffer> {
  const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
  const out = await new GLTFExporter().parseAsync(obj, { binary: true, onlyVisible: false });
  return Buffer.from(out as ArrayBuffer);
}

export async function loadGLB(buf: Buffer): Promise<{ scene: THREE.Group; json: Record<string, unknown> }> {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const gltf = await new Promise<{ scene: THREE.Group; parser: { json: Record<string, unknown> } }>((ok, fail) => new GLTFLoader().parse(ab, "", ok as never, fail));
  return { scene: gltf.scene, json: gltf.parser.json };
}

/** Read the JSON chunk of a GLB without three. */
export function glbJson(buf: Buffer): Record<string, unknown> {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString("utf8"));
}
