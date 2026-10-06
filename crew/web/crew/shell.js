// Set shells: the room or ground a set stands in. The server bake has no walls, floors or ceilings, so a set
// used to be furniture floating in a void. This builds them from procedural textures (no image files):
// wood, tile, carpet and lino floors, plaster and brick walls with skirting and a dado, a ceiling with
// practical lights; streets with asphalt, kerb, paving and a zebra crossing; parks with grass and a path.
// Built with the same three.js copy as the props, so it drops into the viewer's scene unchanged.
import * as THREE from "/vendor/three/three.module.js";

const SRGB = THREE.SRGBColorSpace;
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const cache = new Map();

function canvasTex(key, size, draw, repeat = true) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size, rng(key.length * 7919 + key.charCodeAt(0)));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = SRGB; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  cache.set(key, t);
  return t;
}
const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16), f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
const speckle = (g, S, R, n, a, light = 1, dark = 0) => { for (let i = 0; i < n; i++) { g.fillStyle = R() > 0.5 ? `rgba(255,255,255,${a * light * R()})` : `rgba(0,0,0,${a * (dark || 1) * R()})`; g.fillRect(R() * S, R() * S, 1 + R() * 2, 1 + R() * 2); } };

// ---- textures: each one tiles seamlessly and covers a known size in metres ------------------------------

/** Wood planks, 1 m x 1 m: 6 planks across, staggered joints, grain. */
const wood = (base) => canvasTex(`wood${base}`, 512, (g, S, R) => {
  const n = 6, w = S / n;
  for (let i = 0; i < n; i++) {
    let y = -R() * S * 0.5;
    while (y < S) {
      const len = S * (0.55 + R() * 0.45), k = 0.82 + R() * 0.3;
      g.fillStyle = shade(base, k); g.fillRect(i * w, y, w, len);
      for (let j = 0; j < 14; j++) { g.strokeStyle = `rgba(0,0,0,${0.04 + R() * 0.07})`; g.lineWidth = 1; g.beginPath(); const x = i * w + R() * w; g.moveTo(x, y); g.bezierCurveTo(x + (R() - 0.5) * 6, y + len * 0.3, x + (R() - 0.5) * 6, y + len * 0.7, x + (R() - 0.5) * 4, y + len); g.stroke(); }
      g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(i * w, y, w, 1.5);
      y += len;
    }
    g.fillStyle = "rgba(0,0,0,.4)"; g.fillRect(i * w, 0, 1.5, S);
  }
});
/** Square tiles with grout, 0.6 m: two by two. */
const tile = (a, b, grout = "#8a8780") => canvasTex(`tile${a}${b}`, 512, (g, S, R) => {
  const n = 2, w = S / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = (i + j) % 2 ? a : b; g.fillRect(i * w, j * w, w, w); speckle(g, S, R, 0, 0); }
  speckle(g, S, R, 2200, 0.05);
  g.strokeStyle = grout; g.lineWidth = 5; for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * w, 0); g.lineTo(i * w, S); g.stroke(); g.beginPath(); g.moveTo(0, i * w); g.lineTo(S, i * w); g.stroke(); }
  g.fillStyle = "rgba(255,255,255,.12)"; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) g.fillRect(i * w + 4, j * w + 4, w - 8, 3);
});
/** Carpet: dense fibre speckle, 1 m. */
const carpet = (base) => canvasTex(`carpet${base}`, 256, (g, S, R) => { g.fillStyle = base; g.fillRect(0, 0, S, S); speckle(g, S, R, 9000, 0.16, 1, 1); });
/** Plaster wall: faint mottling, 2 m. */
const plaster = (base) => canvasTex(`plaster${base}`, 512, (g, S, R) => {
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) { const x = R() * S, y = R() * S, r = 20 + R() * 80, a = g.createRadialGradient(x, y, 0, x, y, r); const l = R() > 0.5; a.addColorStop(0, l ? "rgba(255,255,255,.022)" : "rgba(0,0,0,.025)"); a.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = a; g.fillRect(x - r, y - r, r * 2, r * 2); }
  speckle(g, S, R, 5000, 0.03);
});
/** Brick: stretcher bond with mortar, 0.64 m by 0.64 m (8 courses). */
const brick = (base) => canvasTex(`brick${base}`, 512, (g, S, R) => {
  g.fillStyle = "#b9b2a4"; g.fillRect(0, 0, S, S);
  const rows = 8, h = S / rows, w = S / 4;
  for (let r = 0; r < rows; r++) for (let c = -1; c < 4; c++) { const x = c * w + (r % 2 ? w / 2 : 0); g.fillStyle = shade(base, 0.8 + R() * 0.4); g.fillRect(x + 2, r * h + 2, w - 4, h - 4); }
  speckle(g, S, R, 5000, 0.1);
});
/** Lino / vinyl: pale flecked, 1 m. */
const lino = (base) => canvasTex(`lino${base}`, 256, (g, S, R) => { g.fillStyle = base; g.fillRect(0, 0, S, S); speckle(g, S, R, 1800, 0.12); g.strokeStyle = "rgba(0,0,0,.08)"; g.lineWidth = 1; g.strokeRect(0, 0, S, S); });
/** Asphalt, 2 m. */
const asphalt = () => canvasTex("asphalt", 512, (g, S, R) => { g.fillStyle = "#34363a"; g.fillRect(0, 0, S, S); speckle(g, S, R, 14000, 0.22, 1, 1); for (let i = 0; i < 6; i++) { g.strokeStyle = "rgba(0,0,0,.2)"; g.lineWidth = 1 + R() * 2; g.beginPath(); g.moveTo(R() * S, R() * S); g.lineTo(R() * S, R() * S); g.stroke(); } });
/** Paving slabs, 1.2 m: 2 x 2 flags. */
const paving = () => canvasTex("paving", 512, (g, S, R) => { const w = S / 2; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = shade("#9c9a94", 0.88 + R() * 0.24); g.fillRect(i * w, j * w, w, w); } speckle(g, S, R, 5000, 0.12); g.strokeStyle = "#5e5d59"; g.lineWidth = 4; for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * w, 0); g.lineTo(i * w, S); g.stroke(); g.beginPath(); g.moveTo(0, i * w); g.lineTo(S, i * w); g.stroke(); } });
/** Grass, 3 m: blades and patches. */
const grass = () => canvasTex("grass", 512, (g, S, R) => { g.fillStyle = "#4a6b33"; g.fillRect(0, 0, S, S); for (let i = 0; i < 60; i++) { const x = R() * S, y = R() * S, r = 30 + R() * 90, a = g.createRadialGradient(x, y, 0, x, y, r); a.addColorStop(0, R() > 0.5 ? "rgba(120,160,70,.18)" : "rgba(30,60,20,.2)"); a.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = a; g.fillRect(x - r, y - r, r * 2, r * 2); } for (let i = 0; i < 9000; i++) { g.strokeStyle = R() > 0.5 ? "rgba(150,190,90,.35)" : "rgba(25,55,20,.4)"; g.lineWidth = 1; const x = R() * S, y = R() * S; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 3, y - 2 - R() * 4); g.stroke(); } });
/** Gravel path, 2 m. */
const gravel = () => canvasTex("gravel", 512, (g, S, R) => { g.fillStyle = "#a89c86"; g.fillRect(0, 0, S, S); for (let i = 0; i < 4500; i++) { g.fillStyle = shade("#a89c86", 0.7 + R() * 0.6); g.beginPath(); g.ellipse(R() * S, R() * S, 1 + R() * 3, 1 + R() * 2, R() * 3, 0, 6.3); g.fill(); } });

// ---- styles ---------------------------------------------------------------------------------------------

const STYLES = [
  { re: /kitchen|cafe_kitchen/, floor: () => tile("#d8d2c0", "#8a867a"), floorRepeat: 0.6, wall: "#d9d4bf", dado: "#c7cdb8", dadoH: 1.0, ceil: "#efece4", trim: "#f4f1e8", light: "#ffe2b0" },
  { re: /cafe/, floor: () => wood("#5a3b24"), floorRepeat: 1, wall: "#b4553c", brick: true, dado: "#3b2a22", dadoH: 1.05, ceil: "#2f2b29", trim: "#2a2420", light: "#ffc27a" },
  { re: /living/, floor: () => wood("#8a6038"), floorRepeat: 1, wall: "#b9c1b0", dado: null, ceil: "#f2efe6", trim: "#f5f2ea", light: "#ffd9a0" },
  { re: /office/, floor: () => carpet("#59606b"), floorRepeat: 1, wall: "#dcdad2", dado: null, ceil: "#eeeeea", trim: "#d0cfc8", light: "#f2f6ff" },
  { re: /classroom|school/, floor: () => lino("#b7c0a8"), floorRepeat: 1, wall: "#e5dfc6", dado: "#7c9a84", dadoH: 1.1, ceil: "#efece0", trim: "#7c9a84", light: "#f4f1d8" },
  { re: /library/, floor: () => wood("#4b2f1d"), floorRepeat: 1, wall: "#6b4a37", dado: "#3d2819", dadoH: 1.2, ceil: "#3a2a20", trim: "#2b1d14", light: "#ffbe70" },
  { re: /staff/, floor: () => carpet("#4f5e5a"), floorRepeat: 1, wall: "#cfc9b4", dado: "#9b8f78", dadoH: 0.9, ceil: "#e9e5d8", trim: "#e0dccb", light: "#f5f0d8" },
  { re: /corridor|veranda/, floor: () => tile("#c9bfa8", "#a69b86"), floorRepeat: 0.6, wall: "#d8cfb6", dado: "#8d7a60", dadoH: 1.0, ceil: "#e8e2d0", trim: "#cbbf9f", light: "#ffe0a8" },
  { re: /boarding|bedroom|room/, floor: () => wood("#6b4a2e"), floorRepeat: 1, wall: "#c8bca4", dado: null, ceil: "#e9e3d3", trim: "#e6dfcf", light: "#ffd6a0" },
];
const DEFAULT_STYLE = { floor: () => wood("#7a5532"), floorRepeat: 1, wall: "#d2cbb8", dado: null, ceil: "#ece8dd", trim: "#e9e4d6", light: "#ffdfaa" };
const styleFor = (id) => STYLES.find((s) => s.re.test(id)) ?? DEFAULT_STYLE;

const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
function tiled(tex, w, d, per) { const t = tex.clone(); t.needsUpdate = true; t.repeat.set(w / per, d / per); return t; }
const plane = (w, h, mat) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);

// ---- rooms --------------------------------------------------------------------------------------------------

function room(set, id) {
  const S = styleFor(id), { w, d, h } = set, g = new THREE.Group();
  g.name = `shell:${id}`;
  // floor, facing up
  const ft = S.floor(), floorMat = std({ map: tiled(ft, w, d, S.floorRepeat), roughness: /tile|lino/.test(ft.name || "") ? 0.3 : 0.6 });
  const floor = plane(w, d, floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002; g.add(floor);
  // ceiling, facing down (invisible from above, so the Set view still looks in)
  const ceil = plane(w, d, std({ color: S.ceil, roughness: 1 })); ceil.rotation.x = Math.PI / 2; ceil.position.y = h; g.add(ceil);
  // four inward-facing walls: one-sided, so the near wall never blocks an orbit view from outside
  const wallTex = S.brick ? brick(S.wall) : plaster(S.wall);
  const mkWall = (len, rotY, x, z) => {
    const m = std({ map: tiled(wallTex, len, h, S.brick ? 0.64 : 2), color: S.brick ? "#ffffff" : "#ffffff", roughness: 0.95 });
    const mesh = plane(len, h, m); mesh.position.set(x, h / 2, z); mesh.rotation.y = rotY; g.add(mesh);
    if (S.dado) { const dm = std({ color: S.dado, roughness: 0.7 }); const dd = plane(len, S.dadoH, dm); dd.position.set(x, S.dadoH / 2, z); dd.rotation.y = rotY; const n = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY)); dd.position.addScaledVector(n, 0.004); g.add(dd); }
    // skirting and a picture rail, each a thin box proud of the wall (seen only from inside)
    const trim = std({ color: S.trim, roughness: 0.6 }), n = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
    for (const [y, hh, dep] of [[0.06, 0.12, 0.025], [h - 0.05, 0.1, 0.03]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(len, hh, dep), trim); b.position.set(x, y, z).addScaledVector(n, dep / 2 + 0.006); b.rotation.y = rotY; g.add(b); }
  };
  mkWall(w, 0, 0, -d / 2); mkWall(w, Math.PI, 0, d / 2); mkWall(d, Math.PI / 2, -w / 2, 0); mkWall(d, -Math.PI / 2, w / 2, 0);
  // practical lights: panels in the ceiling with a point light under each, one per ~20 m2, at most three
  const n = Math.max(1, Math.min(3, Math.round((w * d) / 20)));
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : -w / 2 + (w * (i + 0.5)) / n, z = 0;
    const panel = plane(Math.min(1.1, w / (n + 1.5)), 0.45, new THREE.MeshBasicMaterial({ color: new THREE.Color(S.light).multiplyScalar(3.2) }));
    panel.rotation.x = Math.PI / 2; panel.position.set(x, h - 0.01, z); g.add(panel);
    const l = new THREE.PointLight(S.light, 9 / Math.sqrt(n), Math.max(w, d) * 1.7, 2); l.position.set(x, h - 0.35, z); l.name = "ceiling-light"; g.add(l);
  }
  return g;
}

// ---- outdoors -----------------------------------------------------------------------------------------------

function street(set, id) {
  const g = new THREE.Group(), W = 140, z0 = -16, z1 = 40; // far beyond the set: the horizon is the buildings and the sky
  const strip = (zA, zB, mat, y = 0) => { const m = plane(W, zB - zA, mat); m.rotation.x = -Math.PI / 2; m.position.set(0, y, (zA + zB) / 2); g.add(m); return m; };
  strip(z0, -1, std({ map: tiled(paving(), W, -1 - z0, 1.2), roughness: 0.85 }), 0.002);                     // pavement: z -16..-1
  strip(-1, z1, std({ map: tiled(asphalt(), W, z1 + 1, 2), roughness: 0.92 }), 0);                          // road: z -1..40
  const kerb = new THREE.Mesh(new THREE.BoxGeometry(W, 0.14, 0.22), std({ color: "#b4b1aa", roughness: 0.8 })); kerb.position.set(0, 0.07, -1.0); g.add(kerb);
  // lane marking: dashed centre line at z 2.6 and double yellow at the kerb
  const dash = std({ color: "#e9e6da", roughness: 0.7 }), yel = std({ color: "#d8c24a", roughness: 0.7 });
  for (let x = -W / 2; x < W / 2; x += 3) { const m = plane(1.6, 0.14, dash); m.rotation.x = -Math.PI / 2; m.position.set(x + 0.8, 0.004, 2.6); g.add(m); }
  for (const z of [-0.78, -0.62]) { const m = plane(W, 0.07, yel); m.rotation.x = -Math.PI / 2; m.position.set(0, 0.004, z); g.add(m); }
  // zebra crossing at the `crossing` anchor, if the set has one
  const cx = (set.anchors ?? []).find((a) => a.id === "crossing");
  if (cx) for (let i = -5; i <= 5; i++) { const m = plane(0.5, 4.8, dash); m.rotation.x = -Math.PI / 2; m.position.set(cx.x + i * 0.9 / 1.0, 0.005, 2.0); g.add(m); }
  return g;
}

function parkGround(set) {
  const g = new THREE.Group(), W = 140;
  const grassMat = std({ map: tiled(grass(), W, 90, 3), roughness: 1 });
  const lawn = plane(W, 90, grassMat); lawn.rotation.x = -Math.PI / 2; lawn.position.set(0, 0, 0); g.add(lawn);
  const path = plane(W, 2.6, std({ map: tiled(gravel(), W, 2.6, 2), roughness: 1 })); path.rotation.x = -Math.PI / 2; path.position.set(0, 0.004, 0); g.add(path);
  for (const z of [-1.4, 1.4]) { const e = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, 0.12), std({ color: "#8b8577", roughness: 0.9 })); e.position.set(0, 0.03, z); g.add(e); }
  return g;
}

function plainGround() {
  const g = new THREE.Group(), m = plane(160, 160, std({ map: tiled(paving(), 160, 160, 1.2), roughness: 0.9 })); m.rotation.x = -Math.PI / 2; g.add(m);
  return g;
}

/** The shell for a baked set: a Group in the set's own coordinates, or null to keep the viewer's plain cubes. */
export function buildShell(set, id) {
  try {
    if (!set.open) return room(set, id);
    if (/street|road|high_street/.test(id)) return street(set, id);
    if (/park|garden|field|lawn/.test(id)) return parkGround(set);
    return plainGround();
  } catch (e) { console.warn(`[crew] shell for ${id} failed`, e); return null; }
}

Object.assign(window.CrewExt, { buildShell, hasShell: true });
