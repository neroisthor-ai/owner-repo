// Shared helpers for library props. Every prop builder returns a THREE.Group
// standing on y=0, centred on x/z, front facing +z, in metres.
import * as THREE from "three";

export { THREE };

/** Seeded RNG so a prop with the same seed always looks the same (renders are deterministic). */
export function rng(seed = 1) {
  let s = (seed * 16807) % 2147483647 || 1;
  const f = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  f.range = (a, b) => a + (b - a) * f();
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  return f;
}

const matCache = new Map();
/** Standard material, cached by its parameters. */
export function mat(color, o = {}) {
  const key = JSON.stringify([color, o]);
  let m = matCache.get(key);
  if (!m) {
    const P = o.physical ? THREE.MeshPhysicalMaterial : o.basic ? THREE.MeshBasicMaterial : THREE.MeshStandardMaterial;
    const { physical, basic, ...rest } = o;
    m = new P(basic ? { color, ...rest } : { color, roughness: 0.7, ...rest });
    matCache.set(key, m);
  }
  return m;
}

export function mesh(geo, material, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}

/** A box whose bottom sits at y (not centred). */
export function box(parent, w, h, d, material, x = 0, y = 0, z = 0) {
  return mesh(new THREE.BoxGeometry(w, h, d), material, parent, x, y + h / 2, z);
}

export function cyl(parent, rTop, rBot, h, material, x = 0, y = 0, z = 0, seg = 16) {
  return mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), material, parent, x, y + h / 2, z);
}

export function group(parent, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  if (parent) parent.add(g);
  return g;
}

/** Canvas texture (works in browsers; in Node tests a canvas shim stands in). */
export function canvasTex(w, h, draw, { srgb = true, repeat = null } = {}) {
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

/** Blotchy fill used all over The Bob (plaster, terrazzo, grass, bark). */
export function noiseFill(g, w, h, base, colors, count, size, r = rng(7)) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    const x = r() * w, y = r() * h, rad = size * (0.3 + r());
    g.globalAlpha = 0.05 + r() * 0.1; g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.beginPath(); g.ellipse(x, y, rad, rad * (0.4 + r() * 0.8), r() * 3, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
}

/** Merge geometries of one material into a single mesh (keeps draw calls low for big props). */
export function merged(parent, geos, material) {
  const g = mergeGeometries(geos);
  return mesh(g, material, parent);
}

export function mergeGeometries(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const p of parts) {
    if (!p.attributes.normal) p.computeVertexNormals();
    pos.set(p.attributes.position.array, o * 3);
    nrm.set(p.attributes.normal.array, o * 3);
    if (p.attributes.uv) uv.set(p.attributes.uv.array, o * 2);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Instanced copies of one geometry (for repeated parts: slats, rivets, books). */
export function instances(parent, geo, material, matrices, colors) {
  const im = new THREE.InstancedMesh(geo, material, matrices.length);
  matrices.forEach((m, i) => im.setMatrixAt(i, m));
  if (colors) colors.forEach((c, i) => im.setColorAt(i, c));
  im.castShadow = true; im.receiveShadow = true;
  parent.add(im);
  return im;
}

export function TM(x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
}

/** Label a built prop with its library id and declared footprint. */
export function finish(g, id, meta = {}) {
  g.name = id;
  g.userData.prop = { id, ...meta };
  return g;
}
