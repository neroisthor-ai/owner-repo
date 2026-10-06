// Structures, landscape and skies. [Low Pass] landmarks (Tower Bridge, Elizabeth
// Tower, the Shard, the London Eye, St Paul's, the facade-shaded block) are built
// at the origin in metres, as the film built them. [The Bob] contributes the
// campus block and the Kilimanjaro backdrop. Skies and the Thames water shader
// are shader materials returned as props so a set can drop them in.
import { THREE, box, canvasTex, cyl, finish, group, instances, mat, mesh, rng, TM } from "./core.js";

const M = (c, o = {}) => mat(c, { roughness: 0.8, ...o });
const V3 = THREE.Vector3;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// Low Pass palette
const granite = () => M("#9b9284", { roughness: 0.9 });
const stoneW = () => M("#efe3c8", { roughness: 0.85 });
const stoneP = () => M("#e8dcc0", { roughness: 0.85 });
const gold = () => M("#d6ad5c", { metalness: 0.9, roughness: 0.3 });
const white = () => M("#eef2f4", { roughness: 0.5, metalness: 0.3 });
const blueSteel = () => M("#86b1d2", { roughness: 0.55, metalness: 0.35 });
const slate = () => M("#3b4046", { roughness: 0.7, metalness: 0.2 });
const darkArch = () => M("#1b1916", { roughness: 0.9 });
const portland = () => M("#d8d2c2", { roughness: 0.85 });

let cwTex = null;
const curtainWall = () => (cwTex ??= canvasTex(128, 128, (g, w, h) => {
  const r = rng(5);
  g.fillStyle = "#e6e6e6"; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) { const v = 120 + Math.floor(r() * 70); g.fillStyle = `rgb(${v},${v},${v + 6})`; g.fillRect(x + 2, y + 4, 28, 25); }
  g.fillStyle = "#f2f2f2"; for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 4);
}, { repeat: [5, 14] }));
/** [Low Pass] Glass curtain-wall material (window grid in the map, metallic). */
const glassM = (c, rough = 0.1, rx = 5, ry = 14) => {
  const m = new THREE.MeshStandardMaterial({ color: c, roughness: rough + 0.04, metalness: 0.8, envMapIntensity: 1.25 });
  const t = curtainWall().clone(); t.repeat.set(rx, ry); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
  m.map = t; m.roughnessMap = t;
  return m;
};

let gothicTex = null;
function gothic(rx, ry, color = "#ffffff") {
  gothicTex ??= canvasTex(256, 256, (g) => {
    const r = rng(12);
    g.fillStyle = "#d9bf8f"; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? 70 : 255},${r() < 0.5 ? 55 : 240},40,${0.04 + r() * 0.05})`; g.fillRect(r() * 256, r() * 256, 2, 2); }
    for (let b = 0; b < 4; b++) {
      const x = b * 64;
      g.fillStyle = "#e6cc98"; g.fillRect(x, 0, 7, 256); g.fillRect(x + 57, 0, 7, 256);
      g.fillStyle = "#cdb384"; g.fillRect(x + 30, 0, 4, 256);
      for (let rr = 0; rr < 2; rr++) { const y = 18 + rr * 128; g.fillStyle = "#2e2a25"; g.beginPath(); g.moveTo(x + 12, y + 100); g.lineTo(x + 12, y + 22); g.quadraticCurveTo(x + 12, y + 4, x + 32, y); g.quadraticCurveTo(x + 52, y + 4, x + 52, y + 22); g.lineTo(x + 52, y + 100); g.closePath(); g.fill(); g.fillStyle = "rgba(210,190,150,0.9)"; g.fillRect(x + 30, y + 4, 4, 96); g.fillRect(x + 12, y + 50, 40, 3); }
    }
    g.fillStyle = "#e8d2a4"; g.fillRect(0, 122, 256, 9); g.fillRect(0, 250, 256, 6);
  });
  const t = gothicTex.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ color, map: t, roughness: 0.85 });
}

const ogee = (r, h) => new THREE.LatheGeometry([[0, 0], [r * 1.15, 0], [r * 1.2, h * 0.1], [r * 1.0, h * 0.35], [r * 0.55, h * 0.6], [r * 0.2, h * 0.85], [0.05, h]].map((p) => new THREE.Vector2(p[0], p[1])), 12);
function archGeo(w, h, d = 0.4) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(-w / 2, h - w * 0.55); s.quadraticCurveTo(-w / 2, h - w * 0.08, 0, h); s.quadraticCurveTo(w / 2, h - w * 0.08, w / 2, h - w * 0.55); s.lineTo(w / 2, 0); s.lineTo(-w / 2, 0);
  return new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
}
const add = (geo, m, x, y, z, parent) => mesh(geo, m, parent, x, y, z);
const hipGeo = (() => {
  const g = new THREE.BufferGeometry();
  const p = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5];
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); g.setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4]);
  const ng = g.toNonIndexed(); ng.computeVertexNormals(); ng.rotateY(Math.PI / 2); return ng;
})();

// ---------------------------------------------------------------- London landmarks [Low Pass]

let roadTex = null;
/** [Low Pass] Tower Bridge: granite base, two Gothic towers, side-span chains, high-level walkways, 300 m deck along z. */
export function tower_bridge() {
  const g = new THREE.Group();
  const DECK = 12;
  roadTex ??= canvasTex(64, 256, (c, w, h) => { const r = rng(3); c.fillStyle = "#2a2a2c"; c.fillRect(0, 0, w, h); for (let i = 0; i < 500; i++) { c.fillStyle = `rgba(255,255,255,${r() * 0.05})`; c.fillRect(r() * w, r() * h, 1, 1); } c.fillStyle = "#d8d4c6"; c.fillRect(31, 0, 2, 90); c.fillRect(31, 128, 2, 90); c.fillRect(3, 0, 1.5, h); c.fillRect(w - 4.5, 0, 1.5, h); }, { repeat: [1, 30] });
  const road = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.85 });
  const bs = blueSteel(), sP = stoneP(), sW = stoneW(), gr = granite(), dk = darkArch(), sl = slate(), au = gold(), wh = white();
  add(new THREE.BoxGeometry(8.4, 0.6, 300), road, 0, DECK - 0.3, 0, g);
  for (const x of [-5.4, 5.4]) add(new THREE.BoxGeometry(2.4, 0.9, 300), sP, x, DECK - 0.15, 0, g);
  add(new THREE.BoxGeometry(13.4, 1.8, 300), bs, 0, DECK - 1.5, 0, g);
  for (const x of [-6.8, 6.8]) { add(new THREE.BoxGeometry(0.45, 1.5, 300), bs, x, DECK + 0.45, 0, g); add(new THREE.BoxGeometry(0.6, 0.15, 300), wh, x, DECK + 1.25, 0, g); }
  const lamps = [];
  for (let z = -144; z <= 144; z += 12) for (const x of [-6.4, 6.4]) if (Math.abs(Math.abs(z) - 39.5) > 10) lamps.push(TM(x, DECK + 2.5, z));
  instances(g, new THREE.CylinderGeometry(0.09, 0.12, 5, 6), M("#2b3a44", { metalness: 0.6 }), lamps);
  const aG = archGeo(1.5, 6, 0.5), aRoad = archGeo(8.6, 11, 0.5);
  for (const s of [-1, 1]) {
    const zc = s * 39.5;
    add(new THREE.BoxGeometry(26, 12, 30), gr, 0, 2, zc, g);
    const cw = add(new THREE.CylinderGeometry(15.2, 15.2, 12, 4), gr, 0, 2, zc, g); cw.rotation.y = Math.PI / 4; cw.scale.set(1.25, 1, 0.7);
    add(new THREE.BoxGeometry(19, 10, 19), gr, 0, 11, zc, g);
    add(new THREE.BoxGeometry(17, 34, 17), gothic(1.2, 2.4, "#efe3c8"), 0, 33, zc, g);
    for (const y of [16, 27, 43, 50]) add(new THREE.BoxGeometry(18, 0.8, 18), sP, 0, y, zc, g);
    add(new THREE.BoxGeometry(15, 7, 15), sW, 0, 53.5, zc, g);
    for (const f of [-1, 1]) { const ar = add(aRoad, dk, 0, DECK, zc + f * 9.55, g); if (f < 0) ar.rotation.y = Math.PI; }
    for (const f of [-1, 1]) for (const lv of [19, 33]) for (const k of [-4, 0, 4]) { const w = add(aG, dk, f * 8.55, lv, zc + k, g); w.rotation.y = (f * Math.PI) / 2; }
    for (const cx of [-8.2, 8.2]) for (const cz of [-8.2, 8.2]) {
      add(new THREE.CylinderGeometry(2.3, 2.5, 50, 8), sW, cx, 33, zc + cz, g);
      for (const y of [27, 43, 50]) add(new THREE.CylinderGeometry(2.75, 2.75, 0.7, 8), sP, cx, y, zc + cz, g);
      add(ogee(2.4, 8), sl, cx, 58, zc + cz, g); add(new THREE.CylinderGeometry(0.12, 0.2, 3, 6), au, cx, 67.5, zc + cz, g); add(new THREE.SphereGeometry(0.35, 8, 6), au, cx, 69.2, zc + cz, g);
    }
    const roof = add(new THREE.ConeGeometry(11.2, 13, 4), sl, 0, 63.5, zc, g); roof.rotation.y = Math.PI / 4;
    add(new THREE.CylinderGeometry(1.0, 1.2, 4, 8), sP, 0, 71.5, zc, g); add(new THREE.ConeGeometry(1.3, 8, 8), sl, 0, 77.5, zc, g); add(new THREE.CylinderGeometry(0.1, 0.18, 3, 6), au, 0, 82.5, zc, g);
    for (const cx of [-6.8, 6.8]) {
      const up = new THREE.CatmullRomCurve3([new V3(cx, 47, s * 48.5), new V3(cx, 30, s * 70), new V3(cx, 21, s * 92), new V3(cx, 26, s * 114), new V3(cx, 33, s * 127)]);
      const lo = new THREE.CatmullRomCurve3(up.points.map((p) => new V3(p.x, p.y - 2.2, p.z)));
      add(new THREE.TubeGeometry(up, 48, 0.55, 6, false), bs, 0, 0, 0, g); add(new THREE.TubeGeometry(lo, 48, 0.45, 6, false), bs, 0, 0, 0, g);
      const ms = [];
      for (let k = 0; k <= 24; k++) {
        const a = up.getPoint(k / 24), b = lo.getPoint(k / 24);
        ms.push(TM(cx, (a.y + b.y) / 2, a.z, 0.25, a.y - b.y, 0.25));
        if (k % 3 === 1) { const hl = b.y - DECK; ms.push(TM(cx, DECK + hl / 2, b.z, 0.2, hl, 0.2)); }
      }
      instances(g, new THREE.BoxGeometry(1, 1, 1), bs, ms);
    }
    add(new THREE.BoxGeometry(12, 26, 12), sW, 0, 19, s * 132, g);
    for (const cx of [-5.6, 5.6]) for (const cz of [-5.6, 5.6]) { add(new THREE.CylinderGeometry(1.2, 1.3, 29, 8), sW, cx, 19.5, s * 132 + cz, g); add(ogee(1.3, 4.5), sl, cx, 34, s * 132 + cz, g); }
    const ar2 = add(new THREE.ConeGeometry(8, 7, 4), sl, 0, 35.5, s * 132, g); ar2.rotation.y = Math.PI / 4;
  }
  for (const cx of [-5, 5]) {
    add(new THREE.BoxGeometry(3.2, 0.8, 62), bs, cx, 43.9, 0, g); add(new THREE.BoxGeometry(3.2, 0.8, 62), bs, cx, 47.3, 0, g); add(new THREE.BoxGeometry(3.6, 0.35, 62), wh, cx, 47.9, 0, g);
    add(new THREE.BoxGeometry(2.9, 2.6, 61), glassM("#2c3a44", 0.1, 1, 1), cx, 45.6, 0, g);
  }
  return finish(g, "tower_bridge", { length: 300 });
}

/** [Low Pass] Elizabeth Tower (Big Ben), 97 m to the finial, four lit clock faces. */
export function elizabeth_tower() {
  const g = new THREE.Group();
  const towerM = gothic(3, 10, "#f2dcae"), sL = M("#eed7a8", { roughness: 0.85 }), au = gold();
  add(new THREE.BoxGeometry(12, 55, 12), towerM, 0, 27.5, 0, g);
  for (const cx of [-6.1, 6.1]) for (const cz of [-6.1, 6.1]) add(new THREE.BoxGeometry(1, 55, 1), sL, cx, 27.5, cz, g);
  add(new THREE.BoxGeometry(13.6, 12, 13.6), sL, 0, 61, 0, g); add(new THREE.BoxGeometry(11, 8, 11), M("#d9c091"), 0, 71, 0, g);
  for (const cx of [-5.8, 5.8]) for (const cz of [-5.8, 5.8]) { add(new THREE.CylinderGeometry(0.45, 0.5, 8, 6), sL, cx, 71, cz, g); add(new THREE.ConeGeometry(0.7, 5, 6), au, cx, 77.5, cz, g); }
  const r1 = add(new THREE.ConeGeometry(8, 17, 4), M("#2d3035", { roughness: 0.45, metalness: 0.6 }), 0, 83.5, 0, g); r1.rotation.y = Math.PI / 4;
  add(new THREE.BoxGeometry(2.6, 3, 2.6), au, 0, 92.5, 0, g); add(new THREE.ConeGeometry(0.9, 6, 6), au, 0, 97, 0, g);
  const face = M("#f3e6c7", { emissive: "#ffdc94", emissiveIntensity: 1.2, roughness: 0.5 }), hand = new THREE.MeshBasicMaterial({ color: "#111111" });
  const hands = [];
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const fg = group(g, dx * 6.82, 61, dz * 6.82, Math.atan2(dx, dz));
    fg.add(new THREE.Mesh(new THREE.PlaneGeometry(8.6, 8.6), au));
    const f1 = new THREE.Mesh(new THREE.CircleGeometry(3.5, 40), face); f1.position.z = 0.03; fg.add(f1);
    const rg = new THREE.Mesh(new THREE.RingGeometry(3.3, 3.55, 40), hand); rg.position.z = 0.05; fg.add(rg);
    const hg = new THREE.PlaneGeometry(0.25, 2.0); hg.translate(0, 0.9, 0); const hh = new THREE.Mesh(hg, hand); hh.position.z = 0.07; fg.add(hh);
    const mg = new THREE.PlaneGeometry(0.18, 2.9); mg.translate(0, 1.35, 0); const mh = new THREE.Mesh(mg, hand); mh.position.z = 0.08; fg.add(mh);
    hands.push([hh, mh]);
    for (const k of [-3, 0, 3]) add(archGeo(1.8, 5.5, 0.3), darkArch(), k, 6.5, 0.02, fg);
  }
  g.userData.update = (secs = 6 * 3600 + 55 * 60) => { for (const [h, m] of hands) { h.rotation.z = -((secs / 43200) % 1) * Math.PI * 2; m.rotation.z = -((secs / 3600) % 1) * Math.PI * 2; } };
  g.userData.update();
  return finish(g, "elizabeth_tower");
}

/** [Low Pass] The Shard: eight leaning glass planes, steel core and a spire lattice (310 m). */
export function shard() {
  const g = new THREE.Group();
  const sm = glassM("#9fb0c2", 0.05, 4, 70); sm.side = THREE.DoubleSide;
  const H0 = 318, Hs = [306, 286, 299, 278, 302, 283, 296, 290], R0 = [34, 31, 35, 30, 34, 31, 35, 30];
  const pos = [], uv = [];
  for (let k = 0; k < 8; k++) {
    const a0 = (k * Math.PI) / 4 + 0.3, a1 = ((k + 1) * Math.PI) / 4 + 0.3, r0 = R0[k], r1 = R0[(k + 1) % 8], f = Hs[k] / H0;
    const b0 = [Math.cos(a0) * r0, Math.sin(a0) * r0], b1 = [Math.cos(a1) * r1, Math.sin(a1) * r1];
    const mx = (b0[0] + b1[0]) / 2, mz = (b0[1] + b1[1]) / 2, ml = Math.hypot(mx, mz), o = (k % 2) * 0.9, ox = (mx / ml) * o, oz = (mz / ml) * o;
    const P = [[b0[0] + ox, 0, b0[1] + oz], [b1[0] + ox, 0, b1[1] + oz], [b1[0] * (1 - f) + ox, Hs[k], b1[1] * (1 - f) + oz], [b0[0] * (1 - f) + ox, Hs[k], b0[1] * (1 - f) + oz]];
    const U = [[0, 0], [1, 0], [1, f], [0, f]];
    const v1 = new V3(...P[1]).sub(new V3(...P[0])), v2 = new V3(...P[2]).sub(new V3(...P[0])), n = v1.cross(v2);
    const ord = n.x * mx + n.z * mz > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const i of ord) { pos.push(...P[i]); uv.push(...U[i]); }
  }
  const ge = new THREE.BufferGeometry();
  ge.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); ge.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); ge.computeVertexNormals();
  add(ge, sm, 0, 0, 0, g);
  const core = add(new THREE.CylinderGeometry(2.5, 30, 268, 8), M("#252b31", { roughness: 0.4, metalness: 0.6 }), 0, 134, 0, g); core.rotation.y = 0.3;
  const lp = [];
  for (let k = 0; k < 8; k++) { const an = (k * Math.PI) / 4 + 0.3 + Math.PI / 8, ra = 34 * (1 - 236 / H0), rb = 34 * (1 - 306 / H0); lp.push(new V3(Math.cos(an) * ra, 236, Math.sin(an) * ra), new V3(Math.cos(an) * rb, 306, Math.sin(an) * rb)); }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lp), new THREE.LineBasicMaterial({ color: "#8d979f" })));
  return finish(g, "shard");
}

/** [Low Pass] London Eye: 120 m wheel with 32 capsules and A-frame legs. userData.update(t) turns it (one rev per 1800 s). */
export function london_eye() {
  const g = new THREE.Group();
  const wh = M("#e8ecef", { roughness: 0.4, metalness: 0.6 });
  const wheel = group(g, 0, 70, 0);
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(60, 0.9, 6, 120), wh)); wheel.add(new THREE.Mesh(new THREE.TorusGeometry(56.5, 0.55, 6, 120), wh));
  const pts = [];
  for (let k = 0; k < 64; k++) { const an = (k / 64) * Math.PI * 2; pts.push(new V3(0, 0, 0), new V3(Math.cos(an) * 57, Math.sin(an) * 57, 0)); }
  wheel.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: "#d9dfe4", transparent: true, opacity: 0.6 })));
  const capM = glassM("#cfe3ee", 0.05, 1, 1);
  const caps = [];
  for (let k = 0; k < 32; k++) { const an = (k / 32) * Math.PI * 2; const c = mesh(new THREE.SphereGeometry(1, 14, 10), capM, wheel, Math.cos(an) * 62.5, Math.sin(an) * 62.5, 0); c.scale.set(2.2, 2.2, 4.4); caps.push(c); }
  wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 8, 12).rotateX(Math.PI / 2), wh));
  for (const sd of [-1, 1]) { const leg = add(new THREE.CylinderGeometry(1.2, 1.7, 84, 8), wh, sd * 18, 35, -24, g); leg.rotation.z = sd * 0.24; leg.rotation.x = -0.3; }
  g.userData.update = (t = 0) => { wheel.rotation.z = -(t / 1800) * Math.PI * 2; };
  return finish(g, "london_eye");
}

/** [Low Pass] St Paul's Cathedral: nave, colonnaded drum, lead dome, lantern, west towers (115 m). */
export function st_pauls() {
  const g = new THREE.Group();
  const pm = portland(), lead = M("#7d837f", { roughness: 0.45, metalness: 0.5 });
  add(new THREE.BoxGeometry(150, 30, 34), pm, 0, 15, 0, g); add(new THREE.BoxGeometry(38, 30, 90), pm, 8, 15, 0, g);
  add(new THREE.CylinderGeometry(21, 21, 14, 32), pm, 8, 37, 0, g);
  const ms = [];
  for (let i = 0; i < 32; i++) { const an = (i / 32) * Math.PI * 2; ms.push(TM(8 + Math.cos(an) * 23, 50 + 6, Math.sin(an) * 23)); }
  instances(g, new THREE.CylinderGeometry(0.9, 0.9, 12, 8), pm, ms);
  add(new THREE.CylinderGeometry(23.5, 23.5, 2, 32), pm, 8, 57, 0, g); add(new THREE.CylinderGeometry(18, 19, 8, 32), pm, 8, 61, 0, g);
  const dm = add(new THREE.SphereGeometry(18, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), lead, 8, 65, 0, g); dm.scale.y = 1.3;
  add(new THREE.CylinderGeometry(3, 3.4, 14, 12), pm, 8, 95 + 7, 0, g); add(new THREE.ConeGeometry(2.4, 10, 12), pm, 8, 107 + 5, 0, g); add(new THREE.SphereGeometry(1.2, 10, 8), gold(), 8, 113 + 5, 0, g);
  for (const z of [-15, 15]) { add(new THREE.BoxGeometry(12, 52, 12), pm, -70, 26, z, g); add(new THREE.CylinderGeometry(4, 5, 10, 10), pm, -70, 57, z, g); add(new THREE.ConeGeometry(3, 6, 10), lead, -70, 65, z, g); }
  return finish(g, "st_pauls");
}

/** [Low Pass] A facade-shaded city block: window grid, ground-floor shops and a lit window or two, in the film's five styles. style 0 terrace brick, 1 stone office, 2 glass, 3 modern resi, 4 stucco. */
export function city_block({ w = 24, d = 18, h = 18, style = 1, seed = 7 } = {}) {
  const g = new THREE.Group();
  const col = ["#a8553a", "#b9b2a0", "#8fa0ae", "#c8c4b8", "#d9d0b8"][style % 5];
  const r = rng(seed);
  const floors = Math.max(2, Math.round(h / 3.3)), cols = Math.max(2, Math.round(w / 3));
  const t = canvasTex(512, 512, (c, W, H) => {
    c.fillStyle = col; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(0,0,0,${r() * 0.05})`; c.fillRect(r() * W, r() * H, r.range(2, 20), r.range(2, 20)); }
    const fh = H / floors, cw = W / cols;
    for (let f = 0; f < floors; f++) for (let k = 0; k < cols; k++) {
      const x = k * cw + cw * 0.2, y = H - (f + 1) * fh + fh * 0.2, ww = cw * 0.6, hh = fh * 0.6;
      if (f === 0 && style !== 2) { c.fillStyle = "#222a30"; c.fillRect(k * cw + 4, H - fh + 6, cw - 8, fh - 6); continue; }
      c.fillStyle = r() > 0.94 ? "#e8b868" : style === 2 ? "#2a3a46" : "#1b2228"; c.fillRect(x, y, ww, hh);
      c.strokeStyle = "rgba(240,236,224,0.8)"; c.lineWidth = 3; c.strokeRect(x - 2, y - 2, ww + 4, hh + 4);
    }
  });
  const side = new THREE.MeshStandardMaterial({ map: t, roughness: style === 2 ? 0.15 : 0.85, metalness: style === 2 ? 0.6 : 0.03 });
  const roofM = M("#444446", { roughness: 0.9 });
  const mats = [side, side, roofM, roofM, side, side];
  mesh(new THREE.BoxGeometry(w, h, d), mats, g, 0, h / 2, 0);
  if (style === 0 || style === 4) { const rf = mesh(hipGeo, M("#4a4a4e", { roughness: 0.6 }), g, 0, h, 0); rf.scale.set(w, 2.5, d); }
  return finish(g, "city_block");
}

// ---------------------------------------------------------------- The Bob campus

/** [The Bob] Hip roof geometry on a w x d footprint with rise rh and overhang. */
export function hipRoof(w, d, rh, over) {
  const W = w / 2 + over, D = d / 2 + over, g = new THREE.BufferGeometry();
  let v;
  if (W >= D) { const r = W - D; v = [-W, 0, D, W, 0, D, r, rh, 0, -W, 0, D, r, rh, 0, -r, rh, 0, W, 0, -D, -W, 0, -D, -r, rh, 0, W, 0, -D, -r, rh, 0, r, rh, 0, W, 0, D, W, 0, -D, r, rh, 0, -W, 0, -D, -W, 0, D, -r, rh, 0]; }
  else { const r = D - W; v = [W, 0, D, W, 0, -D, 0, rh, -r, W, 0, D, 0, rh, -r, 0, rh, r, -W, 0, -D, -W, 0, D, 0, rh, r, -W, 0, -D, 0, rh, r, 0, rh, -r, -W, 0, D, W, 0, D, 0, rh, r, W, 0, -D, -W, 0, -D, 0, rh, -r]; }
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  const uv = []; for (let i = 0; i < v.length; i += 3) uv.push(v[i] * 0.5 + v[i + 2] * 0.15, v[i + 1] * 1.5 + v[i + 2] * 0.5);
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  return g;
}

/** [The Bob] UWC East Africa classroom/boarding block: plastered walls, plinth, hip roof of red tin, windows both faces and a post-and-roof veranda on +z. */
export function campus_block({ w = 30, d = 9, h = 3.6, storeys = 1, roof = "#7b3b2c" } = {}) {
  const g = new THREE.Group();
  const wallM = M("#e7dcc6", { roughness: 0.85 }), plinth = M("#7a3f2c"), postM = M("#f0ebe0", { roughness: 0.6 });
  const rm = new THREE.MeshStandardMaterial({ color: roof, roughness: 0.55, metalness: 0.25, side: THREE.DoubleSide });
  const H = h * storeys / (storeys === 2 ? 1 : 1);
  box(g, w, H, d, wallM, 0, 0, 0); box(g, w + 0.1, 0.55, d + 0.1, plinth, 0, 0, 0);
  if (storeys === 2) box(g, w + 1.6, 0.18, d + 2.4, M("#cfc6b4"), 0, 3.2, 0);
  mesh(hipRoof(w, d, Math.min(w, d) * 0.32, 1.4), rm, g, 0, H, 0);
  const vd = 2.6;
  const vr = box(g, w, 0.12, vd, rm, 0, Math.min(H, 3.3) - 0.1, d / 2 + vd / 2); vr.rotation.x = 0.08;
  for (let px = -w / 2 + 0.3; px <= w / 2; px += 3) cyl(g, 0.09, 0.09, 3.1, postM, px, 0, d / 2 + vd - 0.2, 8);
  const win = M("#1b2228", { roughness: 0.15, metalness: 0.3 });
  const wg = new THREE.PlaneGeometry(1.4, 1.15);
  for (let sx = 0; sx < storeys; sx++) for (let px = -w / 2 + 1.6; px < w / 2 - 1; px += 3.2) for (const sz of [1, -1]) {
    const m = mesh(wg, win, g, px, 1.55 + sx * 3.25, sz * (d / 2 + 0.02)); m.rotation.y = sz > 0 ? 0 : Math.PI; m.castShadow = false;
  }
  return finish(g, "campus_block");
}

const KP = [[0, 0.02], [0.07, 0.1], [0.15, 0.3], [0.21, 0.46], [0.26, 0.53], [0.3, 0.58], [0.34, 0.73], [0.37, 0.9], [0.39, 0.975], [0.41, 0.995], [0.43, 0.985], [0.45, 1.0], [0.47, 0.97], [0.5, 0.86], [0.54, 0.72], [0.59, 0.6], [0.63, 0.57], [0.665, 0.6], [0.69, 0.68], [0.705, 0.77], [0.718, 0.74], [0.73, 0.81], [0.745, 0.75], [0.76, 0.78], [0.785, 0.64], [0.83, 0.46], [0.9, 0.24], [0.96, 0.1], [1, 0.03]];
const h1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const vn1 = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(h1(i), h1(i + 1), u); };
const fbm1 = (x) => { let v = 0, a = 0.5; for (let i = 0; i < 5; i++) { v += a * vn1(x); x *= 2.07; a *= 0.5; } return v; };
/** [The Bob] Kilimanjaro's skyline height (0..1) at u across the range: Shira shoulder, Kibo's rim, the saddle, jagged Mawenzi. */
export function kiliH(u) {
  u = clamp(u, 0, 1);
  let i = 0; while (i < KP.length - 2 && u > KP[i + 1][0]) i++;
  const [u0, h0] = KP[i], [u1, hh1] = KP[i + 1], d = u1 - u0, t = (u - u0) / d;
  const m = (k) => { const a = KP[Math.max(0, k - 1)], b = KP[Math.min(KP.length - 1, k + 1)]; return (b[1] - a[1]) / (b[0] - a[0]); };
  const m0 = m(i) * d, m1 = m(i + 1) * d, t2 = t * t, t3 = t2 * t;
  let h = (2 * t3 - 3 * t2 + 1) * h0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * hh1 + (t3 - t2) * m1;
  h += (fbm1(u * 55) - 0.5) * 0.025;
  h += (fbm1(u * 260 + 9) - 0.5) * 0.07 * clamp(1 - Math.abs(u - 0.73) / 0.07, 0, 1);
  return h;
}

/** [The Bob] Kilimanjaro as a billboard backdrop: banded forest/moor/rock with Kibo's glaciers and a cloud belt. Faces +z; stands at z=0. W wide, H tall. userData.setLook(...) retints it. */
export function kilimanjaro({ W = 480, H = 48 } = {}) {
  const g = new THREE.Group();
  const NX = 420, NY = 30, x0 = -W / 2, base = -0.18 * H;
  const pos = [], col = [], alt = [], idx = [];
  for (let i = 0; i <= NX; i++) {
    const u = i / NX, hp = kiliH(u), sl = (kiliH(u + 0.03) - kiliH(u - 0.03)) / 0.06, kib = clamp(1 - Math.abs(u - 0.42) / 0.13, 0, 1);
    for (let j = 0; j <= NY; j++) {
      const v = j / NY, y = base + Math.pow(v, 0.85) * (hp * H - base), a = y / H;
      pos.push(x0 + u * W, y, -(1 - v) * 4);
      let c = a < 0.3 ? [0.24, 0.33, 0.3] : a < 0.55 ? [0.36, 0.37, 0.42] : [0.38, 0.36, 0.42];
      if (a >= 0.25 && a < 0.35) { const k = (a - 0.25) / 0.1; c = [lerp(0.24, 0.36, k), lerp(0.33, 0.37, k), lerp(0.3, 0.42, k)]; }
      const gul = 0.93 + 0.08 * vn1(u * 60 + a * 2) + 0.06 * vn1(u * 22), lit = 1 + 0.12 * Math.tanh(sl * 0.6);
      c = c.map((q) => q * gul * lit);
      const sline = 0.845 - 0.11 * Math.pow(vn1(u * 150), 4) - 0.05 * vn1(u * 37) + 0.06 * (1 - kib);
      const snow = kib > 0 ? smooth((a - sline) / 0.025) * Math.min(1, kib * 3) : 0;
      const mzS = u > 0.69 && u < 0.78 && a > 0.7 && vn1(u * 300 + a * 30) > 0.72 ? 0.7 : 0;
      const sn = Math.max(snow, mzS);
      c = [lerp(c[0], 1.35, sn), lerp(c[1], 1.37, sn), lerp(c[2], 1.45, sn)];
      col.push(...c); alt.push(clamp(a, 0, 1));
    }
  }
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) { const a = i * (NY + 1) + j, b = a + NY + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const ge = new THREE.BufferGeometry();
  ge.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); ge.setAttribute("kc", new THREE.Float32BufferAttribute(col, 3)); ge.setAttribute("ka", new THREE.Float32BufferAttribute(alt, 1)); ge.setIndex(idx);
  const m = new THREE.ShaderMaterial({
    fog: false, side: THREE.DoubleSide,
    uniforms: { uTint: { value: new V3(1, 1, 1) }, uSnow: { value: 1 }, uHaze: { value: new V3(0.75, 0.72, 0.75) }, uHazeK: { value: 0.42 } },
    vertexShader: "attribute vec3 kc;attribute float ka;varying vec3 vC;varying float vA;void main(){vC=kc;vA=ka;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader: "uniform vec3 uTint,uHaze;uniform float uHazeK,uSnow;varying vec3 vC;varying float vA;void main(){float sn=smoothstep(1.0,1.3,vC.r);vec3 c=vC*uTint*mix(1.,uSnow,sn);float hz=uHazeK*(1.-0.55*vA);gl_FragColor=vec4(mix(c,uHaze,hz),1.);}",
  });
  const mt = new THREE.Mesh(ge, m); mt.frustumCulled = false; g.add(mt);
  const r = rng(77);
  const ct = canvasTex(128, 64, (c, w, h) => { c.clearRect(0, 0, w, h); for (let i = 0; i < 22; i++) { const x = r.range(18, 110), y = r.range(22, 44), rad = r.range(10, 22); const gr = c.createRadialGradient(x, y, 1, x, y, rad); gr.addColorStop(0, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = gr; c.fillRect(0, 0, w, h); } });
  const clouds = [];
  for (let i = 0; i < 16; i++) {
    const u = r.range(0.12, 0.9), sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, opacity: 0.6 }));
    sp.position.set(x0 + u * W, H * r.range(0.3, 0.5) * Math.min(1, kiliH(u) * 1.6), 3); sp.scale.set(W * r.range(0.09, 0.15), H * r.range(0.1, 0.16), 1);
    g.add(sp); clouds.push(sp);
  }
  g.userData.setLook = (tint = [1, 1, 1], haze = [0.75, 0.72, 0.75], hk = 0.42, snow = 1, cloud = 0.6) => {
    m.uniforms.uTint.value.set(...tint); m.uniforms.uHaze.value.set(...haze); m.uniforms.uHazeK.value = hk; m.uniforms.uSnow.value = snow;
    clouds.forEach((c) => { c.material.opacity = cloud; c.visible = cloud > 0.01; });
  };
  return finish(g, "kilimanjaro");
}

// ---------------------------------------------------------------- skies and water

const SKY_VS = "varying vec3 vDir;void main(){vDir=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_Position=p.xyww;}";

/** [Low Pass] Low-sun London sky dome: orange haze toward the sun, deep blue overhead, sun disc. userData.uSun is the direction. */
export function sky_london({ radius = 400, sun = [-0.6, 0.12, 0.35] } = {}) {
  const g = new THREE.Group();
  const m = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new V3(...sun).normalize() } }, side: THREE.BackSide, depthWrite: false, fog: false, vertexShader: SKY_VS,
    fragmentShader: `uniform vec3 uSun;varying vec3 vDir;
void main(){vec3 d=normalize(vDir);float s=max(dot(d,uSun),0.0);float y=d.y;
vec2 dh=normalize(d.xz+1e-5),sh=normalize(uSun.xz);float toward=pow(0.5+0.5*dot(dh,sh),2.2);
vec3 hor=mix(vec3(0.50,0.44,0.50),vec3(1.30,0.62,0.30),toward);float h=clamp(y,0.0,1.0);
vec3 col=mix(hor,vec3(0.07,0.12,0.27),pow(h,0.42));col+=vec3(0.30,0.10,0.02)*exp(-h*12.0)*toward;
col+=vec3(1.0,0.55,0.25)*pow(s,9.0)*0.6+vec3(1.0,0.74,0.45)*pow(s,80.0)*1.7;
col=mix(hor*0.92,col,smoothstep(-0.02,0.04,y));col+=vec3(22.0,14.0,7.0)*smoothstep(0.99986,0.99993,s);gl_FragColor=vec4(col,1.0);}`,
  });
  const d = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), m); d.frustumCulled = false; d.renderOrder = -10; g.add(d);
  g.userData.uniforms = m.uniforms;
  return finish(g, "sky_london");
}

/** [The Bob] East African campus sky: day gradient with fbm cloud, night stars and moon, storm grey. userData.set({day, storm}) blends them. */
export function sky_campus({ radius = 400, day = 1, storm = 0 } = {}) {
  const g = new THREE.Group();
  const m = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new V3(-0.55, 0.42, 0.3).normalize() }, uMoon: { value: new V3(0.35, 0.5, -0.6).normalize() }, uDay: { value: day }, uStorm: { value: storm } },
    side: THREE.BackSide, depthWrite: false, fog: false, vertexShader: SKY_VS,
    fragmentShader: `uniform vec3 uSun,uMoon;uniform float uDay,uStorm;varying vec3 vDir;
float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<6;i++){v+=a*vn(p);p*=2.03;a*=.5;}return v;}
void main(){vec3 d=normalize(vDir);float h=d.y;
vec3 dz=vec3(0.12,0.3,0.7),dh=vec3(0.78,0.86,0.98);vec3 day=mix(dh,dz,pow(clamp(h,0.,1.),0.5));
float sd=max(dot(d,uSun),0.);day+=vec3(1.3,1.0,0.7)*pow(sd,8.)*0.4+vec3(30.,26.,20.)*smoothstep(0.9996,0.9998,sd);
if(h>0.){vec2 cp=d.xz/(h+0.1)*0.6;float c=smoothstep(0.52,0.85,fbm(cp*1.4+vec2(2.,5.)))*smoothstep(0.,0.15,h);day=mix(day,vec3(1.25,1.22,1.18),c*0.75);}
vec3 nz=vec3(0.006,0.012,0.035),nh=vec3(0.03,0.045,0.08);vec3 night=mix(nh,nz,pow(clamp(h,0.,1.),0.6));
float md=max(dot(d,uMoon),0.);night+=vec3(0.25,0.32,0.5)*pow(md,40.)*0.6+vec3(6.,6.4,7.)*smoothstep(0.99985,0.9999,md);
if(h>0.){vec2 sp=floor(d.xz/(h+0.3)*420.);float st=step(0.9975,h21(sp))*h21(sp+3.1);night+=vec3(1.4,1.45,1.6)*st*smoothstep(0.,0.3,h);}
vec3 st=mix(vec3(0.33,0.36,0.4),vec3(0.17,0.19,0.22),clamp(h*1.6,0.,1.));
vec3 col=mix(night,day,uDay);col=mix(col,st,uStorm);if(h<0.)col=mix(col,col*0.6,smoothstep(0.,-0.2,h));gl_FragColor=vec4(col,1.);}`,
  });
  const d = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), m); d.frustumCulled = false; d.renderOrder = -10; g.add(d);
  g.userData.set = ({ day: dv = 1, storm: sv = 0 } = {}) => { m.uniforms.uDay.value = dv; m.uniforms.uStorm.value = sv; };
  return finish(g, "sky_campus");
}

/** [Low Pass] The Thames: shader-lit rolling water with sun glitter and fresnel sky reflection (reflection texture dropped). A w x d plane at y=0. userData.update(t) animates it. */
export function water_thames({ w = 200, d = 200 } = {}) {
  const g = new THREE.Group();
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSun: { value: new V3(-0.6, 0.12, 0.35).normalize() } },
    vertexShader: "varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}",
    fragmentShader: `uniform float uTime;uniform vec3 uSun;varying vec3 vW;
float h13(vec3 p){p=fract(p*0.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float vn3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(h13(i),h13(i+vec3(1,0,0)),f.x),mix(h13(i+vec3(0,1,0)),h13(i+vec3(1,1,0)),f.x),f.y),mix(mix(h13(i+vec3(0,0,1)),h13(i+vec3(1,0,1)),f.x),mix(h13(i+vec3(0,1,1)),h13(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm3(vec3 p){float a=0.5,s=0.0;for(int i=0;i<4;i++){s+=a*vn3(p);p*=2.03;a*=0.5;}return s;}
float hgt(vec2 p){float t=uTime;float h=0.22*sin(dot(p,vec2(0.08,0.03))+t*1.3)+0.16*sin(dot(p,vec2(-0.05,0.11))+t*1.7)+0.1*sin(dot(p,vec2(0.19,-0.07))+t*2.3);return h+0.35*fbm3(vec3(p*0.09,t*0.35));}
void main(){vec2 p=vW.xz;float e=0.6;float h0=hgt(p);
vec3 n=normalize(vec3(-(hgt(p+vec2(e,0.0))-h0)/e,1.0,-(hgt(p+vec2(0.0,e))-h0)/e));n=normalize(mix(vec3(0,1,0),n,0.7));
vec3 v=normalize(cameraPosition-vW);float fr=0.02+0.98*pow(1.0-max(dot(n,v),0.0),5.0);
vec3 r=reflect(-v,n);r.y=abs(r.y);float s=max(dot(r,uSun),0.0);
vec2 dh=normalize(r.xz+1e-5),sh=normalize(uSun.xz);float toward=pow(0.5+0.5*dot(dh,sh),2.2);
vec3 sk=mix(mix(vec3(0.50,0.44,0.50),vec3(1.30,0.62,0.30),toward),vec3(0.07,0.12,0.27),pow(clamp(r.y,0.0,1.0),0.42));
sk+=vec3(1.0,0.6,0.3)*pow(s,12.0)*0.7+vec3(12.0,8.0,4.0)*pow(s,700.0);
vec3 col=mix(vec3(0.040,0.043,0.032),sk*0.9,fr*0.8);col+=vec3(1.0,0.72,0.45)*pow(s,90.0)*0.8*fr;
gl_FragColor=vec4(col,1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,
  });
  const p = mesh(new THREE.PlaneGeometry(w, d), m, g); p.rotation.x = -Math.PI / 2; p.castShadow = false;
  g.userData.update = (t) => { m.uniforms.uTime.value = t; };
  return finish(g, "water_thames", { flat: true });
}
