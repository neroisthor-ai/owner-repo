// Exterior props. [Low Pass] pieces (trees, the Union Jack, bridge lamps, the
// pedestrian crowd) are ported from the film; [The Bob] pieces (jacaranda,
// bougainvillea hedge) from the campus; the rest are new street furniture.
import { THREE, box, canvasTex, cyl, finish, group, instances, mat, mesh, mergeGeometries, rng, TM } from "./core.js";

const M = (c, o = {}) => mat(c, { roughness: 0.8, ...o });
const V3 = THREE.Vector3;

// ---------------------------------------------------------------- trees

/** [Low Pass] Clustered-icosahedra tree (the film's embankment and park trees). ~5 m tall. */
export function tree({ seed = 4, height = 5, leaf = "#2b3a16" } = {}) {
  const g = new THREE.Group();
  const r = rng(seed);
  const crown = mergeGeometries([
    new THREE.IcosahedronGeometry(0.8, 1).translate(0, 0.15, 0), new THREE.IcosahedronGeometry(0.6, 1).translate(0.45, -0.1, 0.2),
    new THREE.IcosahedronGeometry(0.6, 1).translate(-0.35, -0.05, -0.35), new THREE.IcosahedronGeometry(0.5, 1).translate(0.1, 0.55, 0.1),
  ]);
  const p = crown.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.85 + r() * 0.3), p.getY(i) * (0.8 + r() * 0.3), p.getZ(i) * (0.85 + r() * 0.3));
  crown.computeVertexNormals();
  const k = height / 5;
  const trunkH = height * 0.42;
  cyl(g, 0.07 * k * 2, 0.11 * k * 2, trunkH, M("#4a3a2c", { roughness: 0.95 }), 0, 0, 0, 7);
  const c = mesh(crown, M(new THREE.Color(leaf).offsetHSL(0, 0, (r() - 0.5) * 0.06), { roughness: 0.95 }), g, 0, trunkH + 1.1 * k * 1.15, 0);
  c.scale.set(1.5 * k * 1.7, 1.5 * k * 1.9, 1.5 * k * 1.7);
  return finish(g, "tree");
}

const cardTex = (cols, n, rad, seed) => canvasTex(256, 256, (g, w, h) => {
  const r = rng(seed);
  g.clearRect(0, 0, w, h);
  for (let i = 0; i < n; i++) { const a = r() * 6.283, d = Math.sqrt(r()) * rad; g.fillStyle = cols[Math.floor(r() * cols.length)]; g.beginPath(); g.ellipse(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d * 0.8, r.range(3, 7), r.range(2, 4), r() * 3, 0, 7); g.fill(); }
});
const leafMat = (tex, color = "#ffffff") => new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, color });
let jacTex = null, grnTex = null, bouTex = null;

/** [The Bob] Jacaranda in bloom: bark trunk, ~70 alpha-tested leaf cards in purple and green. ~7 m. */
export function jacaranda({ sc = 1.1, seed = 5, bloom = true } = {}) {
  const g = new THREE.Group();
  const r = rng(seed);
  jacTex ??= cardTex(["#7a5cc0", "#8c6fd0", "#6a4cae", "#9a82d8", "#5d7a3a"], 650, 112, 41);
  grnTex ??= cardTex(["#3e5a22", "#4f6b2a", "#5f7a32", "#6f8a3a"], 600, 112, 43);
  cyl(g, 0.14 * sc, 0.24 * sc, 4 * sc, M("#4a3a2c", { roughness: 0.9 }), 0, 0, 0, 8);
  const lm = leafMat(bloom ? jacTex : grnTex, bloom ? "#efe6fa" : "#ffffff");
  for (let k = 0; k < 70; k++) {
    const a = r() * 6.283, d = Math.sqrt(r()) * 3.6 * sc;
    const c = mesh(new THREE.PlaneGeometry(1.8 * sc, 1.8 * sc), lm, g, Math.cos(a) * d, 4.2 * sc + r.range(-0.6, 0.9) * sc * (1 - d / (4 * sc)), Math.sin(a) * d);
    c.rotation.set(-Math.PI / 2 + r.range(-0.7, 0.7), r() * 6, r.range(-0.5, 0.5));
  }
  return finish(g, "jacaranda");
}

/** [The Bob] Hedge of leaf cards. kind: green | bougainvillea. len metres along x. */
export function hedge({ len = 4, h = 1.2, kind = "green", seed = 6 } = {}) {
  const g = new THREE.Group();
  const r = rng(seed);
  grnTex ??= cardTex(["#3e5a22", "#4f6b2a", "#5f7a32", "#6f8a3a"], 600, 112, 43);
  bouTex ??= cardTex(["#c2186b", "#d63384", "#a0104e", "#3e5a22", "#4f6b2a", "#e0479a"], 900, 118, 47);
  const lm = leafMat(kind === "bougainvillea" ? bouTex : grnTex);
  const geo = new THREE.PlaneGeometry(1.1, 1.1);
  for (let x = -len / 2; x < len / 2; x += 0.32) for (let k = 0; k < 5; k++) {
    const c = mesh(geo, lm, g, x + r.range(-0.2, 0.2), 0.55 + r.range(0, h - 0.55), r.range(-0.3, 0.3));
    c.rotation.set(r.range(-1, 1), r() * 6, r.range(-0.5, 0.5));
  }
  return finish(g, "hedge");
}

export function bush({ seed = 3, r: rad = 0.8, color = "#3f5a26" } = {}) {
  const g = new THREE.Group();
  const rr = rng(seed);
  for (let i = 0; i < 5; i++) {
    const s = rad * rr.range(0.55, 1);
    mesh(new THREE.IcosahedronGeometry(s, 1), M(color, { roughness: 0.95 }), g, rr.range(-rad * 0.6, rad * 0.6), s * 0.85, rr.range(-rad * 0.6, rad * 0.6));
  }
  return finish(g, "bush");
}

export function rock({ seed = 2, size = 0.8 } = {}) {
  const g = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(size * 0.5, 2);
  const p = geo.attributes.position;
  // displace by a smooth function of position (not per vertex) so shared corners stay joined
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.18 * Math.sin(x * 7 + seed) * Math.cos(z * 6 + seed * 2) + 0.12 * Math.sin(y * 9 + z * 5 + seed * 3);
    p.setXYZ(i, x * k * 1.2, y * k * 0.7, z * k);
  }
  geo.computeVertexNormals();
  mesh(geo, M("#7d7a74", { roughness: 1 }), g, 0, size * 0.28, 0);
  return finish(g, "rock");
}

export function flower_bed({ w = 2, d = 0.8, seed = 8 } = {}) {
  const g = new THREE.Group();
  const r = rng(seed);
  box(g, w, 0.16, d, M("#5a3a22", { roughness: 1 }));
  const cols = ["#e8c840", "#d04a6a", "#f2f2f2", "#9a6ad0", "#e8843a"];
  const ms = [], cs = [];
  for (let i = 0; i < 40; i++) { ms.push(TM(r.range(-w / 2 + 0.08, w / 2 - 0.08), 0.26, r.range(-d / 2 + 0.08, d / 2 - 0.08), 0.09, 0.09, 0.09)); cs.push(new THREE.Color(r.pick(cols))); }
  instances(g, new THREE.SphereGeometry(1, 8, 6), M("#ffffff"), ms, cs);
  const stems = [];
  for (let i = 0; i < 60; i++) stems.push(TM(r.range(-w / 2 + 0.05, w / 2 - 0.05), 0.2, r.range(-d / 2 + 0.05, d / 2 - 0.05), 0.012, 0.18, 0.012));
  instances(g, new THREE.BoxGeometry(1, 1, 1), M("#3f6a2a"), stems);
  return finish(g, "flower_bed");
}

// ---------------------------------------------------------------- flag [Low Pass]

/** [Low Pass] Waving Union Jack on a pole (flag 9 x 4.5 m in the film; scale it). userData.update(t) waves it. */
export function union_jack({ pole = 12, scale = 0.25 } = {}) {
  const g = new THREE.Group();
  const tex = canvasTex(240, 120, (c, w, h) => {
    c.fillStyle = "#012169"; c.fillRect(0, 0, w, h); c.lineCap = "butt";
    c.strokeStyle = "#fff"; c.lineWidth = 24; c.beginPath(); c.moveTo(0, 0); c.lineTo(w, h); c.moveTo(w, 0); c.lineTo(0, h); c.stroke();
    c.strokeStyle = "#C8102E"; c.lineWidth = 8; c.beginPath(); c.moveTo(0, 0); c.lineTo(w, h); c.moveTo(w, 0); c.lineTo(0, h); c.stroke();
    c.fillStyle = "#fff"; c.fillRect(w / 2 - 20, 0, 40, h); c.fillRect(0, h / 2 - 20, w, 40);
    c.fillStyle = "#C8102E"; c.fillRect(w / 2 - 12, 0, 24, h); c.fillRect(0, h / 2 - 12, w, 24);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const uT = { value: 0 };
  const m = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uT = uT;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uT;").replace("#include <begin_vertex>",
      "#include <begin_vertex>\nfloat k=transformed.x/9.0;transformed.z+=sin(transformed.x*0.9-uT*7.0)*0.45*k+sin(transformed.y*1.3+transformed.x*0.5-uT*5.0)*0.15*k;transformed.y-=k*k*0.5;");
  };
  cyl(g, 0.22 * scale, 0.3 * scale, pole, M("#e8e8e8", { roughness: 0.4, metalness: 0.5 }), 0, 0, 0, 8);
  const ge = new THREE.PlaneGeometry(9, 4.5, 24, 8); ge.translate(4.5, 0, 0);
  const f = mesh(ge, m, g, 0, pole - 2.5 * scale * 4, 0);
  f.scale.setScalar(scale * 1.2); f.position.y = pole - 4.5 * scale * 1.2 * 0.55;
  g.userData.update = (t) => { uT.value = t; };
  return finish(g, "union_jack");
}

// ---------------------------------------------------------------- street furniture

/** [Low Pass] Bridge lamp post: tapered iron post with a lantern head (5.5 m). */
export function bridge_lamp({ on = true } = {}) {
  const g = new THREE.Group();
  cyl(g, 0.1, 0.16, 5.5, M("#1c2622", { metalness: 0.6, roughness: 0.45 }), 0, 0, 0, 6);
  box(g, 0.55, 0.8, 0.55, M("#f2e2c0", { emissive: "#996e33", emissiveIntensity: on ? 0.6 : 0 }), 0, 5.5, 0);
  if (on) { const l = new THREE.PointLight("#ffd9a0", 6, 14, 2); l.position.y = 5.7; g.add(l); }
  return finish(g, "bridge_lamp");
}

/** New. Victorian street lamp (4.2 m). */
export function street_lamp({ on = true } = {}) {
  const g = new THREE.Group();
  const iron = M("#1d2a24", { metalness: 0.6, roughness: 0.4 });
  cyl(g, 0.16, 0.2, 0.3, iron, 0, 0, 0, 8);
  cyl(g, 0.045, 0.07, 3.6, iron, 0, 0.3, 0, 8);
  cyl(g, 0.12, 0.07, 0.12, iron, 0, 3.8, 0, 8);
  mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.34, 6), M("#fff2d0", { emissive: "#ffb46a", emissiveIntensity: on ? 1.2 : 0, roughness: 0.4 }), g, 0, 4.02, 0);
  cyl(g, 0.0, 0.26, 0.12, iron, 0, 4.2, 0, 6);
  if (on) { const l = new THREE.PointLight("#ffc890", 10, 12, 2); l.position.y = 4.0; g.add(l); }
  return finish(g, "street_lamp");
}

export function bench({ len = 1.6 } = {}) {
  const g = new THREE.Group();
  const wd = M("#8a5a30", { roughness: 0.6 }), iron = M("#26302c", { metalness: 0.6, roughness: 0.4 });
  for (let i = 0; i < 4; i++) box(g, len, 0.04, 0.09, wd, 0, 0.43, 0.15 - i * 0.11);
  for (let i = 0; i < 3; i++) { const b = box(g, len, 0.09, 0.03, wd, 0, 0.62 + i * 0.12, -0.2); b.rotation.x = -0.12; }
  for (const x of [-len / 2 + 0.12, len / 2 - 0.12]) { box(g, 0.05, 0.43, 0.5, iron, x, 0, 0); box(g, 0.05, 0.4, 0.04, iron, x, 0.43, -0.22).rotation.x = -0.12; }
  return finish(g, "bench", { sittable: true, sitHeight: 0.45 });
}

export function bin() {
  const g = new THREE.Group();
  cyl(g, 0.22, 0.19, 0.85, M("#2c3a34", { metalness: 0.4, roughness: 0.5 }), 0, 0, 0, 14);
  cyl(g, 0.23, 0.23, 0.06, M("#1a2420", { metalness: 0.5 }), 0, 0.85, 0, 14);
  return finish(g, "bin");
}

export function bollard({ h = 0.9 } = {}) {
  const g = new THREE.Group();
  cyl(g, 0.07, 0.08, h, M("#1c1c20", { metalness: 0.5, roughness: 0.5 }), 0, 0, 0, 12);
  mesh(new THREE.SphereGeometry(0.07, 12, 8, 0, 6.28, 0, 1.57), M("#1c1c20"), g, 0, h, 0);
  cyl(g, 0.082, 0.082, 0.05, M("#d8d4c6"), 0, h * 0.7, 0, 12);
  return finish(g, "bollard");
}

/** Traffic light on a pole (3.4 m). userData.set("red"|"amber"|"green") changes the lamp. */
export function traffic_light() {
  const g = new THREE.Group();
  const dark = M("#1a1c1e", { metalness: 0.5, roughness: 0.5 });
  cyl(g, 0.05, 0.06, 3.0, dark, 0, 0, 0, 8);
  box(g, 0.28, 0.85, 0.22, dark, 0, 2.5, 0.05);
  const lamps = {};
  for (const [name, y, c] of [["red", 3.1, "#ff2a1a"], ["amber", 2.82, "#ffae1a"], ["green", 2.54, "#2aff5a"]]) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(0.12) });
    mesh(new THREE.CircleGeometry(0.075, 14), m, g, 0, y - 0.0, 0.165).castShadow = false;
    lamps[name] = { m, c: new THREE.Color(c) };
  }
  g.userData.set = (state) => { for (const [k, l] of Object.entries(lamps)) l.m.color.copy(l.c).multiplyScalar(k === state ? 3 : 0.12); };
  g.userData.set("red");
  return finish(g, "traffic_light");
}

/** London bus stop: pole, flag sign and a glass shelter. Shelter opens toward +z. */
export function bus_stop() {
  const g = new THREE.Group();
  const frame = M("#b3101a", { roughness: 0.5, metalness: 0.3 }), glass = M("#9fc0d0", { transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.5, side: THREE.DoubleSide, depthWrite: false });
  for (const x of [-1.3, 1.3]) { box(g, 0.06, 2.4, 0.06, frame, x, 0, -0.4); box(g, 0.06, 2.4, 0.06, frame, x, 0, 0.4); }
  box(g, 2.8, 0.08, 1.0, frame, 0, 2.4, 0);
  for (const [w, x, z, ry] of [[2.6, 0, -0.4, 0], [0.8, -1.3, 0, Math.PI / 2], [0.8, 1.3, 0, Math.PI / 2]]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.1), glass); p.position.set(x, 1.25, z); p.rotation.y = ry; g.add(p); }
  box(g, 1.8, 0.05, 0.4, M("#3a3d42", { metalness: 0.5 }), 0, 0.5, -0.2);
  const sign = canvasTex(128, 64, (c, w, h) => { c.fillStyle = "#b3101a"; c.fillRect(0, 0, w, h); c.fillStyle = "#fff"; c.beginPath(); c.arc(32, 32, 24, 0, 7); c.fill(); c.fillStyle = "#b3101a"; c.font = "bold 26px sans-serif"; c.fillText("BUS", 12, 40); c.fillStyle = "#fff"; c.fillText("38", 80, 40); });
  cyl(g, 0.03, 0.03, 3.1, M("#303236", { metalness: 0.6 }), 1.9, 0, 0.3, 8);
  mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.6, side: THREE.DoubleSide }), g, 1.9, 2.85, 0.3);
  return finish(g, "bus_stop");
}

/** Red telephone box (K6). Door at +z. */
export function phone_box() {
  const g = new THREE.Group();
  const red = M("#c4161c", { roughness: 0.4, metalness: 0.2 });
  const win = M("#ffe9b0", { emissive: "#ffb46a", emissiveIntensity: 0.5, transparent: true, opacity: 0.8 });
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) box(g, 0.06, 2.3, 0.06, red, x * 0.43, 0, z * 0.43);
  box(g, 0.92, 2.3, 0.04, red, 0, 0, -0.43);
  for (const x of [-0.43, 0.43]) box(g, 0.04, 2.3, 0.92, red, x, 0, 0);
  box(g, 0.92, 0.08, 0.92, red, 0, 2.3, 0);
  const roof = mesh(new THREE.CylinderGeometry(0.2, 0.62, 0.22, 4), red, g, 0, 2.45, 0); roof.rotation.y = Math.PI / 4;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 8; j++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), win); p.position.set((i - 1) * 0.22, 0.65 + j * 0.2, 0.455); g.add(p); }
  box(g, 0.5, 0.35, 0.14, M("#8a8e94", { metalness: 0.6 }), 0, 1.05, -0.38);
  return finish(g, "phone_box");
}

/** Royal Mail pillar box (1.55 m). */
export function post_box() {
  const g = new THREE.Group();
  const red = M("#b3101a", { roughness: 0.35, metalness: 0.3 });
  cyl(g, 0.26, 0.28, 1.3, red, 0, 0.1, 0, 20);
  cyl(g, 0.3, 0.3, 0.1, red, 0, 0, 0, 20);
  mesh(new THREE.SphereGeometry(0.28, 20, 8, 0, 6.28, 0, 1.57), red, g, 0, 1.4, 0);
  box(g, 0.28, 0.05, 0.02, M("#101010"), 0, 1.05, 0.275);
  return finish(g, "post_box");
}

// ---------------------------------------------------------------- people [Low Pass]

const mergeCol = (list) => {
  const parts = list.map(([g0, c]) => { const g = g0.index ? g0.toNonIndexed() : g0; if (!g.attributes.normal) g.computeVertexNormals(); return [g, c]; });
  let n = 0; for (const [g] of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const [g, c] of parts) {
    pos.set(g.attributes.position.array, o * 3); nrm.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < g.attributes.position.count; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
    o += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
};
const UP = new V3(0, 1, 0);
function limb(a, b, r0, r1, seg = 8) {
  const d = new V3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1); g.translate(0, len / 2, 0);
  g.applyMatrix4(new THREE.Matrix4().compose(a, new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()), new V3(1, 1, 1)));
  return g;
}
function ball(p, sx, sy, sz, seg = 10) { const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg - 3)); g.scale(sx, sy, sz); g.translate(p.x, p.y, p.z); return g; }
const TOPS = ["#141922", "#1b1d21", "#4f4233", "#3f434a", "#5a1619", "#2b3629", "#8a7c64", "#222b3f", "#5d6167", "#362519", "#6d6a62", "#1e3d5a"];
const BOTS = ["#1d2533", "#16181c", "#3a3d44", "#2b3140", "#5a4a3a", "#44474d"];
const SKIN = ["#e3bea5", "#d1a283", "#a9785a", "#7d5139", "#573725", "#f1d2bd", "#c58e6c"];
const HAIR = ["#16110d", "#2e2117", "#5a4026", "#a98a58", "#807a74", "#0e0e0e", "#6b3a1e"];
export const PERSON_POSES = ["pocket", "point", "phone", "shade", "rail", "mouth"];

/** [Low Pass] One member of the film's crowd: lathe-torso body with posed arms, vertex-coloured, head and hair. 1.7 m. */
export function person({ pose = "pocket", seed = 1, kid = false } = {}) {
  const r = rng(seed), g = new THREE.Group();
  const k = kid ? 0.68 : 0.93 + r() * 0.14;
  const col = (list) => new THREE.Color(r.pick(list));
  const C = { top: col(TOPS), bot: col(BOTS), skin: col(SKIN), shoe: new THREE.Color(r() < 0.7 ? "#141414" : "#dcdcdc") };
  const L = [];
  const V = (x, y, z) => new V3(x, y * k, z);
  const lean = (r() - 0.5) * 0.06;
  for (const sx of [-1, 1]) {
    const hip = V(sx * 0.09 + lean, 0.92, 0), knee = V(sx * 0.095 + lean * 0.5, 0.5, 0.02), ank = V(sx * 0.1, 0.09, -0.01);
    L.push([limb(hip, knee, 0.078, 0.062, 9), C.bot], [limb(knee, ank, 0.056, 0.043, 9), C.bot], [ball(V(sx * 0.1, 0.045, 0.06), 0.055, 0.045 * k, 0.13, 8), C.shoe]);
  }
  L.push([ball(V(lean, 0.95, 0), 0.175, 0.12 * k, 0.12), C.bot]);
  const prof = [[0, 0.88], [0.155, 0.9], [0.15, 1.0], [0.142, 1.08], [0.16, 1.2], [0.18, 1.3], [0.19, 1.38], [0.165, 1.45], [0.07, 1.5], [0, 1.5]].map((p) => new THREE.Vector2(p[0], p[1] * k));
  const tor = new THREE.LatheGeometry(prof, 12); tor.scale(1, 1, 0.62); tor.translate(lean * 0.5, 0, 0); L.push([tor, C.top]);
  L.push([limb(V(0, 1.47, 0), V(0, 1.56, 0.01), 0.05, 0.045, 8), C.skin]);
  const arm = (sx, f, ab, b) => {
    const sh = V(sx * 0.19, 1.41, 0); L.push([ball(sh, 0.07, 0.07 * k, 0.07), C.top]);
    const d1 = new V3(sx * Math.sin(ab), -Math.cos(f), Math.sin(f)).normalize(), el = sh.clone().addScaledVector(d1, 0.29 * k);
    const d2 = new V3(sx * Math.sin(ab) * 0.6, -Math.cos(f + b), Math.sin(f + b)).normalize(), wr = el.clone().addScaledVector(d2, 0.26 * k);
    L.push([limb(sh, el, 0.058, 0.05, 8), C.top], [limb(el, wr, 0.048, 0.04, 8), C.top]);
    L.push([ball(wr.clone().addScaledVector(d2, 0.06 * k), 0.04, 0.075 * k, 0.028, 8), C.skin]);
  };
  const j = () => (r() - 0.5) * 0.25;
  switch (pose) {
    case "point": arm(-1, 0.1 + j(), 0.08, 0.2); arm(1, 2.35 + j(), 0.15, 0.1); break;
    case "phone": arm(-1, 0.75, 0.25, 1.55); arm(1, 0.75, 0.25, 1.55); break;
    case "shade": arm(-1, 0.08, 0.1, 0.25); arm(1, 1.55, 0.35, 1.6); break;
    case "rail": arm(-1, 0.62, 0.12, 0.35); arm(1, 0.62, 0.12, 0.35); break;
    case "mouth": arm(-1, 0.1, 0.08, 0.3); arm(1, 0.55, 0.45, 2.2); break;
    default: arm(-1, -0.12 + j() * 0.3, 0.14, 0.35); arm(1, -0.12 + j() * 0.3, 0.14, 0.35);
  }
  mesh(mergeCol(L), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }), g);
  const head = mergeGeometries([ball(new V3(0, 0, 0), 0.092, 0.118, 0.105, 16), new THREE.ConeGeometry(0.02, 0.045, 6).rotateX(Math.PI / 2).translate(0, -0.01, 0.105)]);
  const h = mesh(head, new THREE.MeshStandardMaterial({ color: C.skin, roughness: 0.5 }), g, 0, 1.635 * k, 0);
  h.name = "head";
  const hair = mesh(new THREE.SphereGeometry(0.1, 16, 10, 0, 6.283, 0, 1.95).scale(0.99, 1.1, 1.1).translate(0, 0.012, -0.012), new THREE.MeshStandardMaterial({ color: col(HAIR), roughness: 0.75 }), g, 0, 1.635 * k, 0);
  hair.scale.setScalar(1);
  return finish(g, "person");
}

/** [Low Pass] A crowd of n people scattered over a w x d patch (the Westminster Bridge pedestrians). Each is a mesh pair, so keep n modest. */
export function crowd({ n = 12, w = 6, d = 4, seed = 9 } = {}) {
  const g = new THREE.Group();
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const p = person({ pose: PERSON_POSES[i % PERSON_POSES.length], seed: seed + i * 7, kid: r() < 0.08 });
    p.position.set(r.range(-w / 2, w / 2), 0, r.range(-d / 2, d / 2)); p.rotation.y = r() * 6.283;
    g.add(p);
  }
  return finish(g, "crowd");
}
