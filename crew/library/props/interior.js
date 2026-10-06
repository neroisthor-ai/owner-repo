// Interior props. Pieces marked [The Bob] are lifted from The Bob previs
// (dimensions, construction and colours as the film built them); the rest are
// new, built in the same grey-box-plus style.
import { THREE, box, canvasTex, cyl, finish, group, instances, mat, mesh, noiseFill, rng, TM } from "./core.js";

const wood = (c = "#5a3a24", r = 0.6) => mat(c, { roughness: r });
const D2R = Math.PI / 180;

// ---------------------------------------------------------------- bedroom [The Bob]

/** [The Bob] Boarding-school bed: timber frame, mattress, duvet, pillow. Long axis along z, headboard at -z. */
export function bed_boarding({ duvet = "#3f6a8a", made = true } = {}) {
  const g = new THREE.Group();
  box(g, 1.05, 0.35, 2.2, wood(), 0, 0.075, 0);
  box(g, 1.05, 0.9, 0.08, wood(), 0, 0, -1.11);
  box(g, 1.05, 0.55, 0.08, wood(), 0, 0, 1.11);
  box(g, 1.0, 0.16, 2.1, mat("#e8e4da", { roughness: 0.95 }), 0, 0.42, 0);
  const d = box(g, 1.04, made ? 0.08 : 0.14, 1.5, mat(duvet, { physical: true, roughness: 0.95, sheen: 1 }), 0, 0.58, 0.3);
  d.name = "duvet";
  const p = mesh(new THREE.SphereGeometry(0.28, 16, 10), mat("#f0ece2", { roughness: 0.95 }), g, 0, 0.64, -0.8);
  p.scale.set(1.4, 0.28, 0.9);
  return finish(g, "bed_boarding", { sittable: true, sitHeight: 0.5 });
}

let netTex = null;
/** [The Bob] Mosquito net: a box of fine mesh hung over a bed, or knotted up above it. */
export function mosquito_net({ w = 1.24, l = 2.34, h = 1.45, top = 2.0, knotted = false } = {}) {
  const g = new THREE.Group();
  netTex ??= canvasTex(128, 128, (c, W, H) => {
    c.clearRect(0, 0, W, H); c.fillStyle = "rgba(240,240,236,0.10)"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "rgba(250,250,246,0.55)"; c.lineWidth = 1;
    for (let i = 0; i < W; i += 4) { c.beginPath(); c.moveTo(i + 0.5, 0); c.lineTo(i + 0.5, H); c.stroke(); c.beginPath(); c.moveTo(0, i + 0.5); c.lineTo(W, i + 0.5); c.stroke(); }
  }, { repeat: [10, 6] });
  const net = new THREE.MeshStandardMaterial({ map: netTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 1, color: "#f4f4f0" });
  const bunch = mat("#c8c8c0", { transparent: true, opacity: 0.32, depthWrite: false, roughness: 1, side: THREE.DoubleSide });
  const string = mat("#2a2a2a", { roughness: 0.5 });
  if (knotted) {
    const k = mesh(new THREE.SphereGeometry(0.2, 14, 10), bunch, g, 0, top + 0.1, 0); k.scale.set(1, 1.9, 1); k.castShadow = false;
    box(g, 0.01, 0.3, 0.01, string, 0, top + 0.45, 0);
  } else {
    const y = top - h / 2;
    const pane = (pw, ph, x, py, z, ry, rx = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph, 8, 8), net); m.position.set(x, py, z); m.rotation.set(rx, ry, 0); m.renderOrder = 2; g.add(m); };
    pane(w, h, 0, y, l / 2, 0); pane(w, h, 0, y, -l / 2, 0); pane(l, h, w / 2, y, 0, Math.PI / 2); pane(l, h, -w / 2, y, 0, Math.PI / 2);
    pane(w, l, 0, top, 0, 0, Math.PI / 2);
    box(g, 0.01, 0.38, 0.01, string, 0, top, 0);
  }
  return finish(g, "mosquito_net");
}

/** [The Bob] Tin trunk at the foot of the bed. */
export function tin_trunk({ color = "#2f5a7a" } = {}) {
  const g = new THREE.Group();
  box(g, 0.75, 0.42, 0.45, mat(color, { roughness: 0.4, metalness: 0.5 }));
  for (const x of [-0.3, 0.3]) box(g, 0.04, 0.43, 0.46, mat("#1f3a52", { roughness: 0.4, metalness: 0.6 }), x, 0, 0);
  box(g, 0.1, 0.06, 0.02, mat("#b9a27a", { metalness: 0.9, roughness: 0.3 }), 0, 0.32, 0.23);
  return finish(g, "tin_trunk", { sittable: true, sitHeight: 0.42 });
}

/** [The Bob] Bedside table / small chest. */
export function bedside_table() {
  const g = new THREE.Group();
  box(g, 0.9, 0.75, 0.5, wood());
  for (const y of [0.18, 0.5]) box(g, 0.8, 0.005, 0.02, mat("#3a2414"), 0, y, 0.25);
  return finish(g, "bedside_table");
}

/** [The Bob] Bedside lamp with a warm shade. Pass {on:true} for an emissive shade and a point light. */
export function bedside_lamp({ on = false, light = true } = {}) {
  const g = new THREE.Group();
  cyl(g, 0.05, 0.07, 0.04, mat("#3a2a1a"), 0, 0, 0);
  cyl(g, 0.012, 0.012, 0.2, mat("#3a2a1a"), 0, 0.04, 0, 8);
  const shade = mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.24, 16, 1, true), mat("#e8dcc0", { roughness: 0.8, side: THREE.DoubleSide, emissive: "#ffb46a", emissiveIntensity: on ? 1.2 : 0 }), g, 0, 0.3, 0);
  shade.name = "shade";
  if (light) { const l = new THREE.PointLight("#ffb06a", on ? 6 : 0, 6, 2); l.position.y = 0.32; l.name = "lamp"; g.add(l); }
  return finish(g, "bedside_lamp", { onSurface: true });
}

/** [The Bob] Window with burglar bars, white mullions and curtains (the moon throws the bars across the bed). */
export function window_barred({ w = 1.6, h = 1.2, sill = 0.9, glow = "#5a7ad8", curtains = "#3f5476" } = {}) {
  const g = new THREE.Group();
  const win = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(glow, { basic: true }));
  win.position.set(0, sill + h / 2, -0.04); g.add(win);
  const mull = mat("#e8e6e0", { roughness: 0.6 });
  box(g, 0.05, h, 0.06, mull, 0, sill, 0); box(g, w, 0.05, 0.06, mull, 0, sill + h / 2 - 0.025, 0);
  box(g, w + 0.1, 0.06, 0.08, mull, 0, sill - 0.06, 0); box(g, w + 0.1, 0.06, 0.08, mull, 0, sill + h, 0);
  const bar = mat("#2a2a2a", { roughness: 0.5, metalness: 0.6 });
  for (let x = -w / 2 + 0.08; x <= w / 2 - 0.05; x += 0.15) box(g, 0.018, h, 0.018, bar, x, sill, 0.04);
  for (const y of [sill + 0.2, sill + h - 0.2]) box(g, w, 0.02, 0.018, bar, 0, y, 0.04);
  const cm = mat(curtains, { roughness: 1, side: THREE.DoubleSide });
  for (const x of [-w / 2 - 0.05, w / 2 + 0.05]) { const c = new THREE.Mesh(new THREE.PlaneGeometry(0.5, h + 0.5, 6, 10), cm); c.position.set(x, sill + h / 2 + 0.1, 0.08); g.add(c); }
  return finish(g, "window_barred", { wall: true });
}

/** [The Bob] Kanga cloth hung on a wall. */
export function kanga({ w = 1.4, h = 0.88 } = {}) {
  const g = new THREE.Group();
  const t = canvasTex(512, 320, (c, W, H) => {
    c.fillStyle = "#e8a020"; c.fillRect(0, 0, W, H); c.fillStyle = "#1a1a1a"; c.fillRect(16, 16, W - 32, H - 32); c.fillStyle = "#d23a2a"; c.fillRect(36, 36, W - 72, H - 72);
    for (let i = 0; i < 9; i++) { c.fillStyle = i % 2 ? "#e8a020" : "#1a1a1a"; c.beginPath(); c.arc(W / 2, H / 2, 110 - i * 12, 0, 7); c.fill(); }
    c.fillStyle = "#f4ead0"; for (let i = 0; i < 14; i++) c.fillRect(60 + i * 28, H - 56, 16, 8);
  });
  const k = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, side: THREE.DoubleSide }));
  k.position.set(0, 1.65, 0.01); g.add(k);
  return finish(g, "kanga", { wall: true });
}

/** Ceiling fan (The Bob's staffroom fan slows with the clock). userData.update(t) spins it. */
export function ceiling_fan({ ceiling = 2.7, drop = 0.5, speed = 4 } = {}) {
  const g = new THREE.Group();
  const m = mat("#e8e4dc", { roughness: 0.5, metalness: 0.2 });
  cyl(g, 0.012, 0.012, drop, m, 0, ceiling - drop, 0, 8);
  const rot = group(g, 0, ceiling - drop, 0);
  cyl(rot, 0.09, 0.11, 0.12, m, 0, -0.06, 0);
  for (let i = 0; i < 3; i++) { const b = box(rot, 0.6, 0.012, 0.14, mat("#8a6a48", { roughness: 0.5 }), 0, -0.02, 0); b.geometry.translate(0.35, 0, 0); b.rotation.y = (i * 2 * Math.PI) / 3; b.rotation.x = 0.12; }
  g.userData.update = (t) => { rot.rotation.y = t * speed; };
  return finish(g, "ceiling_fan", { ceiling: true });
}

/** [The Bob] Wall clock with live hands. userData.update(seconds of day). */
export function wall_clock({ r = 0.17, y = 2.1 } = {}) {
  const g = new THREE.Group();
  const face = mesh(new THREE.CylinderGeometry(r, r, 0.04, 40), mat("#f4f0e4", { roughness: 0.5 }), g, 0, y, 0.02);
  face.rotation.x = Math.PI / 2;
  const rim = mesh(new THREE.TorusGeometry(r, 0.012, 8, 40), mat("#2a2420", { roughness: 0.4, metalness: 0.4 }), g, 0, y, 0.04);
  rim.castShadow = false;
  const ticks = [];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; ticks.push(TM(Math.sin(a) * r * 0.85, y + Math.cos(a) * r * 0.85, 0.045, 0.008, i % 3 ? 0.02 : 0.04, 0.004, 0, 0, -a)); }
  instances(g, new THREE.BoxGeometry(1, 1, 1), mat("#1a1a1a"), ticks);
  const hand = (len, w, z) => { const pv = group(g, 0, y, z); const hm = box(pv, w, len, 0.004, mat("#111111"), 0, 0, 0); hm.position.y = len / 2; return pv; };
  const hh = hand(r * 0.5, 0.012, 0.05), mh = hand(r * 0.75, 0.008, 0.055), sh = hand(r * 0.85, 0.003, 0.06);
  g.userData.update = (secs) => { hh.rotation.z = -((secs / 43200) % 1) * Math.PI * 2; mh.rotation.z = -((secs / 3600) % 1) * Math.PI * 2; sh.rotation.z = -(Math.floor(secs) % 60) / 60 * Math.PI * 2; };
  g.userData.update(4 * 3600 + 52 * 60);
  return finish(g, "wall_clock", { wall: true });
}

/** [The Bob] Panel door in a frame. userData.open(angle) swings it (radians, + opens toward +z). */
export function door({ w = 0.9, h = 2.05, color = "#7a5a3a" } = {}) {
  const g = new THREE.Group();
  const fm = mat("#4a3a2a", { roughness: 0.6 });
  box(g, 0.06, h + 0.06, 0.12, fm, -w / 2 - 0.03, 0, 0); box(g, 0.06, h + 0.06, 0.12, fm, w / 2 + 0.03, 0, 0); box(g, w + 0.12, 0.06, 0.12, fm, 0, h, 0);
  const hinge = group(g, -w / 2, 0, 0);
  const leaf = box(hinge, w, h, 0.05, mat(color, { roughness: 0.6 }), w / 2, 0, 0);
  for (const y of [0.35, 1.25]) box(hinge, w - 0.2, 0.5, 0.01, mat(color, { roughness: 0.5 }), w / 2, y, 0.03);
  mesh(new THREE.SphereGeometry(0.03, 10, 8), mat("#c9a54a", { metalness: 0.9, roughness: 0.3 }), hinge, w - 0.08, 1.0, 0.05);
  leaf.name = "leaf";
  g.userData.open = (a) => { hinge.rotation.y = -a; };
  return finish(g, "door", { wall: true });
}

/** [The Bob] Poster on a wall. */
export function poster({ w = 0.5, h = 0.7, color = "#c4553e" } = {}) {
  const g = new THREE.Group();
  const t = canvasTex(128, 180, (c, W, H) => { c.fillStyle = color; c.fillRect(0, 0, W, H); c.fillStyle = "rgba(255,255,255,0.85)"; c.font = "bold 22px sans-serif"; c.fillText("UWC", 12, 40); c.fillStyle = "rgba(0,0,0,0.25)"; c.beginPath(); c.arc(W / 2, H * 0.6, 34, 0, 7); c.fill(); });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }));
  p.position.set(0, 1.6, 0.005); g.add(p);
  return finish(g, "poster", { wall: true });
}

// ---------------------------------------------------------------- study [The Bob library]

/** [The Bob] Leather-bound book; userData.cover is a pivot you can open. */
export function leather_book({ color = "#4a1712" } = {}) {
  const g = new THREE.Group();
  const r = rng(11);
  const t = canvasTex(128, 256, (c, W, H) => { c.fillStyle = color; c.fillRect(0, 0, W, H); c.globalAlpha = 0.25; for (let i = 0; i < 500; i++) { c.fillStyle = r() < 0.5 ? "#2a0a08" : "#6a2a20"; c.fillRect(r() * W, r() * H, r.range(1, 4), r.range(1, 4)); } c.globalAlpha = 1; c.strokeStyle = "#b08a3c"; c.lineWidth = 3; c.strokeRect(10, 14, W - 20, H - 28); });
  const lm = new THREE.MeshStandardMaterial({ map: t, roughness: 0.55 });
  mesh(new THREE.BoxGeometry(0.17, 0.012, 0.24), lm, g, 0, 0.006, 0);
  mesh(new THREE.BoxGeometry(0.16, 0.03, 0.23), mat("#e6dcc0", { roughness: 0.9 }), g, 0, 0.025, 0);
  const cv = group(g, -0.085, 0.042, 0);
  mesh(new THREE.BoxGeometry(0.17, 0.012, 0.24), lm, cv, 0.085, 0, 0);
  g.userData.cover = cv;
  return finish(g, "leather_book", { onSurface: true });
}

const BOOK_PALETTE = ["#6b1f1a", "#1f3a5a", "#2f4f2f", "#5a4a2a", "#3a2a4a", "#7a5a2a", "#2a2a2a", "#8a3a2a", "#1a4a4a", "#c9b48a"];

/** [The Bob] A messy stack of books, as piled round Bob's library table. */
export function book_stack({ n = 9, seed = 3 } = {}) {
  const g = new THREE.Group();
  const r = rng(seed);
  let y = 0;
  const ms = [], cs = [];
  for (let i = 0; i < n; i++) {
    const th = r.range(0.03, 0.065), w = r.range(0.17, 0.25), d = r.range(0.24, 0.31);
    ms.push(TM(r.range(-0.02, 0.02), y + th / 2, r.range(-0.02, 0.02), w, th, d, 0, r.range(-0.25, 0.25), 0));
    cs.push(new THREE.Color(r.pick(BOOK_PALETTE)).multiplyScalar(r.range(0.7, 1.1)));
    y += th;
  }
  instances(g, new THREE.BoxGeometry(1, 1, 1), mat("#ffffff", { roughness: 0.8 }), ms, cs);
  return finish(g, "book_stack", { onSurface: true });
}

/** [The Bob] Library shelf unit filled with books (uprights, gaps, the odd leaning book). Back at -z. */
export function bookshelf({ len = 2.0, h = 2.2, shelves = 6, depth = 0.3, seed = 5, books = true } = {}) {
  const g = new THREE.Group();
  const dw = mat("#3a2414", { roughness: 0.6 });
  const r = rng(seed);
  box(g, len, h, 0.03, dw, 0, 0, -depth / 2);
  const nU = Math.max(2, Math.round(len / 1.0) + 1), ux = [];
  for (let i = 0; i < nU; i++) { const x = -len / 2 + (len * i) / (nU - 1); ux.push(x); box(g, 0.045, h, depth + 0.03, dw, x, 0, 0); }
  box(g, len + 0.1, 0.1, depth + 0.1, dw, 0, h, 0);
  const gap = (h - 0.12) / shelves;
  for (let i = 0; i <= shelves; i++) box(g, len, 0.03, depth + 0.03, dw, 0, 0.065 + i * gap, 0);
  if (books) {
    const ms = [], cs = [];
    for (let i = 0; i < shelves; i++) {
      const yb = 0.095 + i * gap;
      let x = -len / 2 + 0.04;
      while (x < len / 2 - 0.04) {
        if (r() < 0.035) { x += r.range(0.06, 0.25); continue; }
        if (ux.some((u) => Math.abs(u - x) < 0.035)) { x += 0.05; continue; }
        const w = r.range(0.02, 0.06), hh = r.range(0.17, Math.min(0.34, gap - 0.04)), d = r.range(0.15, Math.min(0.24, depth - 0.02));
        const rz = r() < 0.04 ? r.range(0.12, 0.3) * (r() < 0.5 ? -1 : 1) : 0;
        ms.push(TM(x + w / 2, yb + hh / 2, depth / 2 - d / 2 - 0.01, w, hh, d, 0, 0, rz));
        cs.push(new THREE.Color(r.pick(BOOK_PALETTE)).multiplyScalar(r.range(0.7, 1.2)));
        x += w + r.range(0, 0.004);
      }
    }
    instances(g, new THREE.BoxGeometry(1, 1, 1), mat("#ffffff", { roughness: 0.8 }), ms, cs);
  }
  return finish(g, "bookshelf");
}

/** [The Bob] Green banker's lamp on Bob's library table. */
export function bankers_lamp({ on = true } = {}) {
  const g = new THREE.Group();
  const brass = mat("#b08a4a", { roughness: 0.3, metalness: 1 });
  cyl(g, 0.07, 0.09, 0.03, brass, 0, 0, 0, 24);
  cyl(g, 0.01, 0.01, 0.32, brass, 0, 0.02, -0.04, 10);
  const shade = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.28, 24, 1, true, 0, Math.PI), mat("#1f6b45", { physical: true, roughness: 0.15, clearcoat: 1, side: THREE.DoubleSide, emissive: "#0c3a22", emissiveIntensity: 0.6 }), g, 0, 0.34, 0);
  shade.rotation.set(0, Math.PI / 2 + 0.3, Math.PI / 2);
  if (on) { const l = new THREE.PointLight("#ffd9a0", 3, 3, 2); l.position.set(0, 0.28, 0.05); g.add(l); }
  return finish(g, "bankers_lamp", { onSurface: true });
}

/** [The Bob] A sheet of aged paper, optionally covered in the film's impossible equations. */
export function paper_note({ equations = true, w = 0.21, h = 0.297 } = {}) {
  const g = new THREE.Group();
  const r = rng(17);
  const t = canvasTex(512, 640, (c, W, H) => {
    c.fillStyle = "#efe6cf"; c.fillRect(0, 0, W, H); c.globalAlpha = 0.08; for (let i = 0; i < 300; i++) { c.fillStyle = r() < 0.5 ? "#a08860" : "#fff"; c.fillRect(r() * W, r() * H, 2, 2); } c.globalAlpha = 1;
    if (equations) { c.fillStyle = "#2a1e14"; c.font = "italic 34px Georgia, serif"; ["∮ e^{iπx} dx", "= Σ (n=1→∞) 1/n² · ∂/∂t", "√(−λ) · det|A − λI|", "lim ζ(s) · Γ(½)", "∇ × B = μ₀J + …"].forEach((s, i) => c.fillText(s, 40, 90 + i * 90)); }
  });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, side: THREE.DoubleSide }));
  p.rotation.x = -Math.PI / 2; p.position.y = 0.001; g.add(p);
  return finish(g, "paper_note", { onSurface: true });
}

/** [The Bob] The Elixir of Undoing: a small glowing bottle with its own light. userData.pulse(t). */
export function elixir_bottle({ glow = 1 } = {}) {
  const g = new THREE.Group();
  const glass = mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.07, 16), mat("#cfe8d8", { physical: true, roughness: 0.05, transparent: true, opacity: 0.35 }), g, 0, 0.035, 0);
  glass.castShadow = false;
  const lm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6 * glow, 4.0 * glow, 0.9 * glow) });
  mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.05, 16), lm, g, 0, 0.028, 0).castShadow = false;
  cyl(g, 0.009, 0.011, 0.02, mat("#3a2a1a", { roughness: 0.6 }), 0, 0.07, 0, 12);
  cyl(g, 0.012, 0.012, 0.012, mat("#222222", { roughness: 0.4 }), 0, 0.088, 0, 12);
  const pl = new THREE.PointLight("#7dff9a", 0.6 * glow, 1.6, 2); pl.position.y = 0.04; g.add(pl);
  g.userData.pulse = (t, k = 1) => { const p = 0.75 + 0.25 * Math.sin(t * 6.5); lm.color.setRGB(0.6 * p, 4.0 * p * k, 0.9 * p); pl.intensity = 0.7 * p * k; };
  return finish(g, "elixir_bottle", { onSurface: true });
}

/** [The Bob] Mug with a handle and a drink in it. */
export function mug({ color = "#f2efe8", drink = "#4a2c1a" } = {}) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.3, side: THREE.DoubleSide });
  mesh(new THREE.CylinderGeometry(0.042, 0.038, 0.1, 24, 1, true), m, g, 0, 0.05, 0);
  mesh(new THREE.CircleGeometry(0.038, 24), m, g, 0, 0.002, 0).rotation.x = -Math.PI / 2;
  const h = mesh(new THREE.TorusGeometry(0.026, 0.007, 8, 16, Math.PI), m, g, 0.042, 0.05, 0); h.rotation.z = -Math.PI / 2;
  const l = mesh(new THREE.CircleGeometry(0.039, 24), mat(drink, { roughness: 0.15 }), g, 0, 0.085, 0); l.rotation.x = -Math.PI / 2; l.name = "drink";
  return finish(g, "mug", { onSurface: true });
}

/** [The Bob] Rising steam for a hot drink. userData.update(t). */
export function steam() {
  const g = new THREE.Group();
  const t = canvasTex(64, 64, (c) => { const r = c.createRadialGradient(32, 32, 2, 32, 32, 30); r.addColorStop(0, "rgba(255,255,255,0.6)"); r.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = r; c.fillRect(0, 0, 64, 64); });
  const ps = [];
  for (let i = 0; i < 6; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.25 })); s.scale.setScalar(0.06); g.add(s); ps.push(s); }
  g.userData.update = (time) => ps.forEach((s, i) => { const u = (time * 0.5 + i / 6) % 1; s.position.set(Math.sin(time * 1.3 + i) * 0.01 * u, 0.1 + u * 0.18, Math.cos(time + i) * 0.008 * u); s.scale.setScalar(0.04 + u * 0.07); s.material.opacity = 0.22 * (1 - u) * Math.min(1, u * 5); });
  g.userData.update(0);
  return finish(g, "steam", { onSurface: true });
}

/** [The Bob] Library reading table (the one Bob is walled in at). */
export function library_table({ w = 1.6, d = 0.9, h = 0.775 } = {}) {
  const g = new THREE.Group();
  const top = mat("#6b4a2e", { roughness: 0.45 });
  box(g, w, 0.045, d, top, 0, h - 0.045, 0);
  box(g, w - 0.1, 0.1, d - 0.1, wood("#4a3020"), 0, h - 0.145, 0);
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) box(g, 0.07, h - 0.045, 0.07, wood("#4a3020"), x * (w / 2 - 0.08), 0, z * (d / 2 - 0.08));
  const felt = box(g, w * 0.5, 0.002, d * 0.45, mat("#1f4a33", { roughness: 1 }), 0, h, 0);
  felt.castShadow = false;
  return finish(g, "library_table", { surface: h });
}

/** Wooden chair (library / staffroom / classroom). Seat at 0.45 m. */
export function chair_wood({ color = "#6b4a2e" } = {}) {
  const g = new THREE.Group();
  const m = wood(color, 0.55);
  box(g, 0.44, 0.04, 0.42, m, 0, 0.43, 0);
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) box(g, 0.035, 0.43, 0.035, m, x * 0.19, 0, z * 0.18);
  for (const x of [-0.19, 0.19]) box(g, 0.035, 0.45, 0.035, m, x, 0.47, -0.18);
  box(g, 0.42, 0.12, 0.025, m, 0, 0.78, -0.185);
  box(g, 0.42, 0.06, 0.025, m, 0, 0.6, -0.185);
  return finish(g, "chair_wood", { sittable: true, sitHeight: 0.45 });
}

/** School desk with a lift-up lid (classroom). */
export function school_desk() {
  const g = new THREE.Group();
  const frame = mat("#3a3d42", { roughness: 0.4, metalness: 0.7 });
  box(g, 0.65, 0.03, 0.48, wood("#a0784e", 0.5), 0, 0.72, 0);
  box(g, 0.6, 0.14, 0.42, wood("#8a6440", 0.6), 0, 0.58, 0);
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) box(g, 0.025, 0.58, 0.025, frame, x * 0.29, 0, z * 0.2);
  box(g, 0.58, 0.02, 0.02, frame, 0, 0.15, -0.2);
  return finish(g, "school_desk", { surface: 0.75 });
}

/** Staffroom / office armchair with low arms. */
export function armchair({ color = "#6a4a3a" } = {}) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.9 });
  box(g, 0.8, 0.42, 0.8, m, 0, 0.1, 0);
  box(g, 0.8, 0.5, 0.18, m, 0, 0.5, -0.31);
  for (const x of [-0.34, 0.34]) box(g, 0.12, 0.2, 0.8, m, x, 0.52, 0);
  box(g, 0.56, 0.1, 0.58, mat(color, { roughness: 0.95 }), 0, 0.52, 0.06);
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) cyl(g, 0.02, 0.015, 0.1, wood("#2a1a10"), x * 0.34, 0, z * 0.34, 8);
  return finish(g, "armchair", { sittable: true, sitHeight: 0.46 });
}

// ---------------------------------------------------------------- living room (new)

/** Three-seat sofa. Back at -z. */
export function sofa({ w = 2.0, color = "#4a5a6a" } = {}) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.92 });
  box(g, w, 0.3, 0.9, m, 0, 0.1, 0);
  box(g, w, 0.55, 0.2, m, 0, 0.35, -0.35);
  for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) box(g, 0.2, 0.3, 0.9, m, x, 0.4, 0);
  const n = Math.max(2, Math.round((w - 0.4) / 0.55));
  for (let i = 0; i < n; i++) { const cw = (w - 0.4) / n; box(g, cw - 0.02, 0.14, 0.66, mat(color, { roughness: 0.95 }), -w / 2 + 0.2 + cw * (i + 0.5), 0.4, 0.08); }
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) cyl(g, 0.025, 0.02, 0.1, wood("#2a1a10"), x * (w / 2 - 0.08), 0, z * 0.38, 8);
  return finish(g, "sofa", { sittable: true, sitHeight: 0.45 });
}

export function coffee_table({ w = 1.1, d = 0.6 } = {}) {
  const g = new THREE.Group();
  box(g, w, 0.04, d, wood("#7a5a3a", 0.4), 0, 0.4, 0);
  box(g, w - 0.1, 0.02, d - 0.1, wood("#6a4a2a", 0.6), 0, 0.12, 0);
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) box(g, 0.04, 0.4, 0.04, wood("#4a3020"), x * (w / 2 - 0.05), 0, z * (d / 2 - 0.05));
  return finish(g, "coffee_table", { surface: 0.44 });
}

export function dining_table({ w = 1.4, d = 0.9 } = {}) {
  const g = new THREE.Group();
  box(g, w, 0.05, d, wood("#8a6a4a", 0.45), 0, 0.7, 0);
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) box(g, 0.06, 0.7, 0.06, wood("#6a4a2a"), x * (w / 2 - 0.08), 0, z * (d / 2 - 0.08));
  return finish(g, "dining_table", { surface: 0.75 });
}

export function tv_stand({ w = 1.4 } = {}) {
  const g = new THREE.Group();
  box(g, w, 0.45, 0.4, wood("#2a2a2e", 0.5));
  const tv = group(g, 0, 0.45, -0.05);
  box(tv, 0.3, 0.02, 0.2, mat("#1a1a1a"), 0, 0, 0);
  box(tv, 0.05, 0.08, 0.03, mat("#1a1a1a"), 0, 0.02, 0);
  box(tv, 1.22, 0.7, 0.05, mat("#0c0c0e", { roughness: 0.3 }), 0, 0.1, 0);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 0.66), mat("#10141c", { roughness: 0.1, emissive: "#203048", emissiveIntensity: 0 }));
  screen.position.set(0, 0.45, 0.026); screen.name = "screen"; tv.add(screen);
  return finish(g, "tv_stand");
}

export function rug({ w = 2.0, d = 1.4, color = "#8a3a2a" } = {}) {
  const g = new THREE.Group();
  const t = canvasTex(256, 180, (c, W, H) => { c.fillStyle = color; c.fillRect(0, 0, W, H); c.strokeStyle = "#e8d8b0"; c.lineWidth = 6; c.strokeRect(12, 12, W - 24, H - 24); c.strokeStyle = "#2a2a3a"; c.lineWidth = 3; c.strokeRect(26, 26, W - 52, H - 52); c.fillStyle = "#e8d8b0"; c.beginPath(); c.ellipse(W / 2, H / 2, 40, 26, 0, 0, 7); c.fill(); });
  const r = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
  r.rotation.x = -Math.PI / 2; r.position.y = 0.004; r.receiveShadow = true; g.add(r);
  return finish(g, "rug", { flat: true });
}

export function floor_lamp({ on = true } = {}) {
  const g = new THREE.Group();
  const m = mat("#2a2a2a", { roughness: 0.4, metalness: 0.6 });
  cyl(g, 0.14, 0.16, 0.03, m, 0, 0, 0, 20);
  cyl(g, 0.012, 0.012, 1.45, m, 0, 0.03, 0, 8);
  mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.28, 20, 1, true), mat("#efe2c8", { roughness: 0.9, side: THREE.DoubleSide, emissive: "#ffb46a", emissiveIntensity: on ? 0.8 : 0 }), g, 0, 1.5, 0);
  if (on) { const l = new THREE.PointLight("#ffc890", 8, 6, 2); l.position.y = 1.45; g.add(l); }
  return finish(g, "floor_lamp");
}

export function potted_plant({ h = 1.1, seed = 9 } = {}) {
  const g = new THREE.Group();
  const r = rng(seed);
  cyl(g, 0.17, 0.13, 0.3, mat("#b0623a", { roughness: 0.8 }), 0, 0, 0, 18);
  cyl(g, 0.16, 0.16, 0.02, mat("#3a2a1a", { roughness: 1 }), 0, 0.28, 0, 18);
  const leaf = mat("#3f7a3a", { roughness: 0.7, side: THREE.DoubleSide });
  for (let i = 0; i < 14; i++) {
    const L = r.range(0.35, h - 0.3), a = r() * Math.PI * 2;
    const stem = group(g, 0, 0.3, 0, a);
    const lf = mesh(new THREE.PlaneGeometry(0.16, L), leaf, stem, 0, L / 2, 0);
    lf.rotation.x = r.range(0.15, 0.6);
    lf.geometry.translate(0, 0, 0);
  }
  return finish(g, "potted_plant");
}

export function wardrobe({ w = 1.0, h = 2.0 } = {}) {
  const g = new THREE.Group();
  box(g, w, h, 0.58, wood("#6a4a30", 0.55));
  box(g, 0.005, h - 0.1, 0.01, mat("#2a1a10"), 0, 0.05, 0.29);
  for (const x of [-0.06, 0.06]) box(g, 0.02, 0.25, 0.03, mat("#c9a54a", { metalness: 0.9, roughness: 0.3 }), x, 0.95, 0.3);
  return finish(g, "wardrobe");
}

// ---------------------------------------------------------------- kitchen (new, sized like the demo kitchen)

export function kitchen_counter({ w = 1.6, color = "#e8e2d6", top = "#6a6a6a" } = {}) {
  const g = new THREE.Group();
  box(g, w, 0.1, 0.56, mat("#1a1a1a"), 0, 0, 0.02);
  box(g, w, 0.78, 0.6, mat(color, { roughness: 0.6 }), 0, 0.1, 0);
  box(g, w + 0.02, 0.04, 0.64, mat(top, { roughness: 0.3, metalness: 0.1 }), 0, 0.88, 0.01);
  const doors = Math.max(1, Math.round(w / 0.6));
  for (let i = 0; i < doors; i++) { const dw = w / doors; box(g, dw - 0.02, 0.005, 0.005, mat("#888888", { metalness: 0.8 }), -w / 2 + dw * (i + 0.5), 0.8, 0.305); }
  return finish(g, "kitchen_counter", { surface: 0.92 });
}

export function fridge({ color = "#e8eaec" } = {}) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.35, metalness: 0.2 });
  box(g, 0.75, 1.85, 0.7, m);
  const hinge = group(g, -0.37, 0, 0.36);
  box(hinge, 0.74, 1.2, 0.05, m, 0.37, 0.62, 0);
  box(hinge, 0.03, 0.5, 0.04, mat("#9a9ca0", { metalness: 0.8, roughness: 0.3 }), 0.68, 1.05, 0.04);
  box(g, 0.74, 0.58, 0.05, m, 0, 0.02, 0.36);
  const glow = new THREE.PointLight("#e8f4ff", 0, 2.5, 2); glow.position.set(0, 1.2, 0.2); g.add(glow);
  g.userData.open = (a) => { hinge.rotation.y = -a; glow.intensity = a > 0.1 ? 3 : 0; };
  return finish(g, "fridge");
}

export function sink_unit() {
  const g = kitchen_counter({ w: 0.8 });
  const basin = box(g, 0.46, 0.005, 0.36, mat("#b8bcc0", { metalness: 0.9, roughness: 0.25 }), 0, 0.921, 0.02);
  basin.castShadow = false;
  const tap = mat("#c8ccd0", { metalness: 0.9, roughness: 0.2 });
  cyl(g, 0.015, 0.018, 0.22, tap, 0, 0.92, -0.2, 10);
  box(g, 0.02, 0.02, 0.14, tap, 0, 1.12, -0.14);
  return finish(g, "sink_unit", { surface: 0.92 });
}

export function stove() {
  const g = new THREE.Group();
  box(g, 0.7, 0.92, 0.65, mat("#2a2c30", { roughness: 0.4, metalness: 0.3 }));
  for (const [x, z] of [[-0.17, -0.15], [0.17, -0.15], [-0.17, 0.15], [0.17, 0.15]]) cyl(g, 0.09, 0.09, 0.01, mat("#111111", { roughness: 0.6 }), x, 0.92, z, 20);
  box(g, 0.6, 0.38, 0.02, mat("#0c0c0e", { roughness: 0.15 }), 0, 0.3, 0.33);
  return finish(g, "stove", { surface: 0.93 });
}

export function kettle({ color = "#c8ccd0" } = {}) {
  const g = new THREE.Group();
  const m = mat(color, { metalness: 0.85, roughness: 0.25 });
  mesh(new THREE.SphereGeometry(0.1, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), m, g, 0, 0.07, 0).scale.set(1, 1.15, 1);
  cyl(g, 0.09, 0.1, 0.07, m, 0, 0, 0, 20);
  const handle = mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 16, Math.PI), mat("#1a1a1a"), g, 0, 0.19, 0); handle.rotation.y = Math.PI / 2;
  const spout = cyl(g, 0.012, 0.022, 0.1, m, 0.11, 0.08, 0, 10); spout.rotation.z = -0.9;
  return finish(g, "kettle", { onSurface: true });
}

export function plate({ r = 0.12, color = "#f4f2ee" } = {}) {
  const g = new THREE.Group();
  mesh(new THREE.CylinderGeometry(r, r * 0.7, 0.02, 28), mat(color, { roughness: 0.25 }), g, 0, 0.01, 0);
  return finish(g, "plate", { onSurface: true });
}

export function cake({ r = 0.12, h = 0.09, sponge = "#d9b07a", icing = "#f3b6c4" } = {}) {
  const g = new THREE.Group();
  cyl(g, r, r, h, mat(sponge, { roughness: 0.8 }), 0, 0, 0, 28);
  cyl(g, r + 0.004, r + 0.004, 0.02, mat(icing, { roughness: 0.4 }), 0, h, 0, 28);
  const cut = box(g, r, h + 0.02, 0.004, mat("#c89a6a", { roughness: 0.9 }), r / 2, 0, 0); cut.visible = false; cut.name = "slice";
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; mesh(new THREE.SphereGeometry(0.012, 8, 6), mat("#d23a3a", { roughness: 0.3 }), g, Math.cos(a) * r * 0.75, h + 0.025, Math.sin(a) * r * 0.75); }
  return finish(g, "cake", { onSurface: true });
}

export function fork() {
  const g = new THREE.Group();
  const m = mat("#c8ccd4", { metalness: 0.9, roughness: 0.25 });
  box(g, 0.012, 0.004, 0.12, m, 0, 0, 0.03);
  for (const x of [-0.008, -0.003, 0.003, 0.008]) box(g, 0.0025, 0.003, 0.045, m, x, 0, -0.055);
  return finish(g, "fork", { onSurface: true });
}

// ---------------------------------------------------------------- office / classroom (new)

export function office_desk({ w = 1.4, d = 0.7 } = {}) {
  const g = new THREE.Group();
  box(g, w, 0.03, d, mat("#e8e4dc", { roughness: 0.5 }), 0, 0.72, 0);
  for (const x of [-1, 1]) box(g, 0.04, 0.72, d - 0.05, mat("#3a3d42", { metalness: 0.6, roughness: 0.4 }), x * (w / 2 - 0.04), 0, 0);
  box(g, 0.4, 0.6, d - 0.08, mat("#d8d4cc", { roughness: 0.5 }), w / 2 - 0.25, 0.1, 0);
  return finish(g, "office_desk", { surface: 0.75 });
}

export function office_chair({ color = "#2a2c30" } = {}) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.8 });
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const leg = box(g, 0.03, 0.03, 0.3, mat("#1a1a1a", { metalness: 0.6 }), Math.sin(a) * 0.15, 0.05, Math.cos(a) * 0.15); leg.rotation.y = a; mesh(new THREE.SphereGeometry(0.03, 8, 6), mat("#111111"), g, Math.sin(a) * 0.3, 0.03, Math.cos(a) * 0.3); }
  cyl(g, 0.025, 0.025, 0.35, mat("#888888", { metalness: 0.8 }), 0, 0.08, 0, 10);
  box(g, 0.48, 0.08, 0.46, m, 0, 0.43, 0);
  box(g, 0.46, 0.55, 0.06, m, 0, 0.55, -0.24);
  return finish(g, "office_chair", { sittable: true, sitHeight: 0.48 });
}

export function computer() {
  const g = new THREE.Group();
  const dark = mat("#1a1c20", { roughness: 0.4 });
  box(g, 0.22, 0.012, 0.18, dark, 0, 0, -0.1);
  box(g, 0.04, 0.3, 0.03, dark, 0, 0.01, -0.12);
  const scr = box(g, 0.56, 0.34, 0.03, dark, 0, 0.18, -0.1);
  const lit = new THREE.Mesh(new THREE.PlaneGeometry(0.53, 0.31), mat("#2a4a7a", { emissive: "#3a6ab0", emissiveIntensity: 0.6 }));
  lit.position.set(0, 0.35, -0.084); g.add(lit); scr.name = "monitor";
  box(g, 0.44, 0.02, 0.14, mat("#2a2c30"), 0, 0, 0.14);
  return finish(g, "computer", { onSurface: true });
}

export function laptop({ open = 1.9 } = {}) {
  const g = new THREE.Group();
  const m = mat("#a8acb2", { metalness: 0.7, roughness: 0.35 });
  box(g, 0.32, 0.015, 0.22, m);
  const lid = group(g, 0, 0.015, -0.11);
  box(lid, 0.32, 0.22, 0.008, m, 0, 0, 0).geometry.translate(0, 0, 0);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(0.29, 0.18), mat("#203a5a", { emissive: "#3a5a90", emissiveIntensity: 0.5 }));
  s.position.set(0, 0.11, 0.005); lid.add(s);
  lid.rotation.x = -(Math.PI - open);
  return finish(g, "laptop", { onSurface: true });
}

export function filing_cabinet() {
  const g = new THREE.Group();
  box(g, 0.47, 1.3, 0.62, mat("#8a8e94", { metalness: 0.5, roughness: 0.4 }));
  for (let i = 0; i < 4; i++) box(g, 0.12, 0.02, 0.02, mat("#c8ccd0", { metalness: 0.9, roughness: 0.2 }), 0, 0.2 + i * 0.32, 0.32);
  return finish(g, "filing_cabinet");
}

export function chalkboard({ w = 3.0, h = 1.2, text = "" } = {}) {
  const g = new THREE.Group();
  const t = canvasTex(512, 205, (c, W, H) => { c.fillStyle = "#24302a"; c.fillRect(0, 0, W, H); c.globalAlpha = 0.06; for (let i = 0; i < 60; i++) { c.fillStyle = "#ffffff"; c.fillRect(Math.random() * W, Math.random() * H, 60, 6); } c.globalAlpha = 0.9; c.fillStyle = "#e8e8e0"; c.font = "italic 26px Georgia, serif"; (text || "∫ f(x) dx = F(b) − F(a)").split("\n").forEach((l, i) => c.fillText(l, 24, 50 + i * 36)); });
  const b = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }));
  b.position.set(0, 1.5, 0.02); g.add(b);
  const f = mat("#6a4a2e", { roughness: 0.6 });
  box(g, w + 0.1, 0.05, 0.05, f, 0, 0.88, 0.02); box(g, w + 0.1, 0.05, 0.05, f, 0, 2.1, 0.02);
  box(g, w, 0.03, 0.08, f, 0, 0.88, 0.05);
  return finish(g, "chalkboard", { wall: true });
}

export function whiteboard({ w = 2.0, h = 1.1 } = {}) {
  const g = new THREE.Group();
  box(g, w + 0.04, h + 0.04, 0.02, mat("#b8bcc2", { metalness: 0.7, roughness: 0.3 }), 0, 0.88, 0);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat("#f6f6f4", { roughness: 0.15 }));
  s.position.set(0, 0.9 + h / 2, 0.012); g.add(s);
  return finish(g, "whiteboard", { wall: true });
}

export function phone({ lit = true } = {}) {
  const g = new THREE.Group();
  box(g, 0.075, 0.009, 0.155, mat("#111216", { roughness: 0.3 }));
  if (lit) { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.14), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.4, 1.7) })); s.rotation.x = -Math.PI / 2; s.position.y = 0.0095; g.add(s); }
  return finish(g, "phone", { onSurface: true });
}

export function newspaper() {
  const g = new THREE.Group();
  const t = canvasTex(256, 320, (c, W, H) => { c.fillStyle = "#e8e4d8"; c.fillRect(0, 0, W, H); c.fillStyle = "#1a1a1a"; c.font = "bold 26px Georgia"; c.fillText("THE DAILY", 40, 36); c.fillStyle = "#555555"; for (let y = 60; y < H - 10; y += 9) for (let x = 12; x < W - 12; x += 80) c.fillRect(x, y, 70, 3); });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.38), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, side: THREE.DoubleSide }));
  p.rotation.x = -Math.PI / 2; p.position.y = 0.003; g.add(p);
  return finish(g, "newspaper", { onSurface: true });
}
