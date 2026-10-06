// Grey-box NPR animatic. Plays baked frames from the server verbatim:
// cameras on ones, characters on twos, toon shading with ink outlines.
// Set geometry comes from the server (the same boxes QC checks against).
// Performance layer (gait, idle breathing, blinks, talk motion) after The Bob.
import * as THREE from "/vendor/three/three.module.js";

const D2R = Math.PI / 180;
const LIGHT = {
  day: { amb: 0.9, key: 1.6, warm: 0 }, night: { amb: 0.35, key: 0.55, warm: 0.1 }, warm: { amb: 0.75, key: 1.4, warm: 0.6 },
  cool: { amb: 0.7, key: 1.2, warm: -0.5 }, dim: { amb: 0.3, key: 0.5, warm: 0 }, bright: { amb: 1.2, key: 2.0, warm: 0 },
  practical: { amb: 0.32, key: 0.35, warm: 0.2, practical: 2.6 }, moon: { amb: 0.25, key: 1.1, warm: -0.8 },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** The Bob's blink schedule: irregular, ~every 3.3s, 140ms */
function blinkAt(t, seed) {
  const P = 3.3, x = t + seed * 7.3, k = Math.floor(x / P);
  const off = ((Math.abs(Math.sin(k * 91.7 + seed * 13)) * 43.7) % 1) * 2.4;
  const d = x - k * P - off;
  return d > 0 && d < 0.14;
}

function toonGradient() {
  const t = new THREE.DataTexture(new Uint8Array([70, 70, 70, 255, 165, 165, 165, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

export class Player {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 200);
    this.grad = toonGradient();
    this.ink = new THREE.MeshBasicMaterial({ color: 0x0b0d12, side: THREE.BackSide });
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 1);
    this.key = new THREE.DirectionalLight(0xffffff, 1.5);
    this.key.position.set(3, 6, 4);
    this.practical = new THREE.PointLight(0xfff2d0, 0, 6, 1.4);
    this.scene.add(this.hemi, this.key, this.practical);
    this.chars = {};
    this.props = {};
    this.baked = null;
    this.setKey = null;
    this.fixedSize = null;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    if (this.fixedSize) return;
    const box = this.canvas.parentElement.getBoundingClientRect();
    let w = box.width, h = (w * 9) / 16;
    if (h > box.height) { h = box.height; w = (h * 16) / 9; }
    this.renderer.setSize(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)), true);
    if (this.baked && this.lastT !== undefined) this.frame(this.lastT);
  }

  /** Render at an exact pixel size (export); call with null to go back to the viewer size. */
  setFixedSize(size) {
    this.fixedSize = size;
    if (size) { this.renderer.setPixelRatio(1); this.renderer.setSize(size[0], size[1], false); }
    else { this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio)); this.canvas.style.width = ""; this.canvas.style.height = ""; this.resize(); }
  }

  mat(color) { return new THREE.MeshToonMaterial({ color, gradientMap: this.grad }); }
  outlined(geo, mat, scale = 1.04) {
    const m = new THREE.Mesh(geo, mat);
    const o = new THREE.Mesh(geo, this.ink);
    o.scale.setScalar(scale);
    m.add(o);
    return m;
  }

  load(baked) {
    this.baked = baked;
    this.setKey = null;
    for (const c of Object.values(this.chars)) this.scene.remove(c.root);
    this.chars = {};
    let seed = 0.3;
    for (const [id, c] of Object.entries(baked.cast)) this.chars[id] = this.buildChar(id, c, (seed += 0.37));
  }

  // ------------------------------------------------------------ set (geometry solved on the server)
  buildSet(setId, paletteId) {
    if (this.setRoot) this.scene.remove(this.setRoot);
    for (const p of Object.values(this.props)) this.scene.remove(p);
    this.props = {};
    this.fridgeGlow = null;
    const s = this.baked.sets[setId];
    const pal = this.baked.palettes[paletteId] ?? Object.values(this.baked.palettes)[0];
    this.scene.background = new THREE.Color(pal.bg);
    const root = new THREE.Group();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.d), this.mat(pal.floor));
    floor.rotation.x = -Math.PI / 2;
    root.add(floor);
    const grid = new THREE.GridHelper(Math.max(s.w, s.d), Math.round(Math.max(s.w, s.d) * 2), 0x000000, 0x000000);
    grid.material.opacity = 0.07; grid.material.transparent = true; grid.position.y = 0.002;
    root.add(grid);
    const wallMat = this.mat(pal.wall);
    const wall = (w, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, s.h), wallMat); m.position.set(x, s.h / 2, z); m.rotation.y = ry; root.add(m); };
    wall(s.w, 0, -s.d / 2, 0); wall(s.w, 0, s.d / 2, Math.PI); wall(s.d, -s.w / 2, 0, Math.PI / 2); wall(s.d, s.w / 2, 0, -Math.PI / 2);
    const furnMat = this.mat(pal.prop);
    for (const b of s.boxes) {
      const g = new THREE.Group();
      g.position.set(b.cx, b.cy, b.cz);
      g.rotation.y = b.yaw;
      if (b.kind === "chair") {
        const seat = this.outlined(new THREE.BoxGeometry(b.w, 0.06, b.d), furnMat, 1.03);
        seat.position.y = 0.45 - b.h / 2;
        const back = this.outlined(new THREE.BoxGeometry(b.w, 0.45, 0.05), furnMat, 1.03);
        back.position.set(0, 0.45 - b.h / 2 + 0.25, -b.d / 2 + 0.03);
        g.add(seat, back);
        for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.04), furnMat); l.position.set(x * (b.w / 2 - 0.04), -b.h / 2 + 0.225, z * (b.d / 2 - 0.04)); g.add(l); }
      } else if (b.kind === "table" || b.kind === "desk") {
        const top = this.outlined(new THREE.BoxGeometry(b.w, 0.05, b.d), furnMat, 1.02);
        top.position.y = b.h / 2 - 0.025;
        g.add(top);
        for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, b.h, 0.06), furnMat); l.position.set(x * (b.w / 2 - 0.08), 0, z * (b.d / 2 - 0.08)); g.add(l); }
      } else {
        const m = this.outlined(new THREE.BoxGeometry(b.w, b.h, b.d), b.kind === "window" ? this.mat(0x9fc3ff) : b.kind === "door" ? this.mat(pal.floor) : furnMat, 1.015);
        g.add(m);
      }
      root.add(g);
      if (b.kind === "fridge") {
        const fwd = new THREE.Vector3(Math.sin(b.yaw), 0, Math.cos(b.yaw));
        this.fridgeGlow = new THREE.Vector3(b.cx, 1.0, b.cz).addScaledVector(fwd, -(b.d / 2 + 0.25));
      }
    }
    for (const p of s.props) {
      let mesh;
      if (p.id.includes("door")) {
        const pivot = new THREE.Group();
        const panel = this.outlined(new THREE.BoxGeometry(0.72, 1.8, 0.05), this.mat(0xdfe6ee), 1.03);
        panel.position.set(0.36, 0.9, 0);
        pivot.add(panel);
        pivot.userData.door = true;
        mesh = pivot;
      } else if (/cake|pie/.test(p.id)) mesh = this.outlined(new THREE.CylinderGeometry(0.12, 0.12, 0.09, 20), this.mat(0xf3b6c4));
      else if (/mug|cup|glass/.test(p.id)) mesh = this.outlined(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 14), this.mat(0xffffff));
      else if (/fork|knife|spoon|pen/.test(p.id)) mesh = this.outlined(new THREE.BoxGeometry(0.02, 0.012, 0.18), this.mat(0xc8ccd4));
      else if (/phone/.test(p.id)) mesh = this.outlined(new THREE.BoxGeometry(0.08, 0.01, 0.15), this.mat(0x222222));
      else mesh = this.outlined(new THREE.BoxGeometry(0.15, 0.15, 0.15), this.mat(0xf5efe6));
      this.props[p.id] = mesh;
      this.scene.add(mesh);
    }
    this.scene.add(root);
    this.setRoot = root;
    this.setKey = `${setId}|${paletteId}`;
  }

  // ------------------------------------------------------------ characters: two-segment limbs, The Bob's gait
  buildChar(id, c, seed) {
    const h = c.height, k = h / 1.7;
    const body = new THREE.Color(c.color);
    const skin = body.clone().lerp(new THREE.Color(0xffffff), 0.55);
    const root = new THREE.Group();
    const hips = new THREE.Group();
    root.add(hips);
    const thigh = 0.245 * h, shin = 0.235 * h, torso = 0.3 * h, upper = 0.19 * h, fore = 0.17 * h, headR = 0.068 * h, r = 0.045 * k;
    const legMat = this.mat(body.clone().multiplyScalar(0.5)), cloth = this.mat(body), skinMat = this.mat(skin);
    const seg = (len, rad, mat) => { const g = new THREE.Group(); const m = this.outlined(new THREE.CapsuleGeometry(rad, Math.max(0.01, len - rad * 2), 4, 8), mat, 1.08); m.position.y = -len / 2; g.add(m); return g; };
    const limb = (l1, l2, rad, m1, m2) => { const a = seg(l1, rad, m1), b = seg(l2, rad * 0.9, m2); b.position.y = -l1; a.add(b); a.userData.lower = b; return a; };
    const legL = limb(thigh, shin, r * 1.25, legMat, legMat), legR = limb(thigh, shin, r * 1.25, legMat, legMat);
    legL.position.x = -0.09 * k; legR.position.x = 0.09 * k;
    hips.add(legL, legR);
    const spine = new THREE.Group();
    hips.add(spine);
    const chest = new THREE.Group();
    chest.position.y = torso * 0.45;
    spine.add(chest);
    const trunk = this.outlined(new THREE.CapsuleGeometry(0.17 * k, torso - 0.12, 4, 12), cloth, 1.05);
    trunk.position.y = torso * 0.05;
    trunk.scale.z = 0.7;
    chest.add(trunk);
    const armL = limb(upper, fore, r, cloth, skinMat), armR = limb(upper, fore, r, cloth, skinMat);
    armL.position.set(-0.21 * k, torso * 0.5, 0); armR.position.set(0.21 * k, torso * 0.5, 0);
    chest.add(armL, armR);
    const neck = new THREE.Group();
    neck.position.y = torso * 0.55 + 0.04;
    chest.add(neck);
    const faceCanvas = document.createElement("canvas");
    faceCanvas.width = 256; faceCanvas.height = 128;
    const faceTex = new THREE.CanvasTexture(faceCanvas);
    faceTex.colorSpace = THREE.SRGBColorSpace;
    const head = this.outlined(new THREE.SphereGeometry(headR, 24, 16), new THREE.MeshToonMaterial({ map: faceTex, gradientMap: this.grad }), 1.06);
    head.position.y = headR * 1.05;
    neck.add(head);
    const hair = this.outlined(new THREE.SphereGeometry(headR * 1.05, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), this.mat(body.clone().multiplyScalar(0.32)), 1.04);
    hair.rotation.x = -0.25;
    head.add(hair);
    root.visible = false;
    this.scene.add(root);
    return { id, c, seed, root, hips, spine, chest, neck, head, legL, legR, armL, armR, legLen: thigh + shin, thigh, faceCanvas, faceTex, skin: "#" + skin.getHexString(), faceKey: "" };
  }

  drawFace(ch, expr, talk, blink, gaze) {
    const key = `${expr}|${Math.round(talk * 4)}|${blink ? 1 : 0}|${Math.round(gaze * 3)}`;
    if (ch.faceKey === key) return;
    ch.faceKey = key;
    const g = ch.faceCanvas.getContext("2d");
    const W = 256, H = 128, cx = W * 0.25, ey = H * 0.44, my = H * 0.64, dx = W * 0.045;
    g.fillStyle = ch.skin; g.fillRect(0, 0, W, H);
    g.strokeStyle = "#141821"; g.fillStyle = "#141821"; g.lineCap = "round"; g.lineWidth = 3.2;
    const e = expr, big = e === "shock" || e === "scared";
    const brow = (s, inner, outer) => { g.beginPath(); g.moveTo(cx + s * dx * 0.45, ey - 11 - inner); g.lineTo(cx + s * dx * 1.45, ey - 11 - outer); g.stroke(); };
    const b = { angry: [-5, 3], frown: [-3, 1], sad: [5, -1], cry: [6, -1], scared: [6, 4], shock: [7, 7], guilty: [4, 0], think: [0, 4] }[e] ?? [1, 1];
    brow(-1, b[0], b[1]); brow(1, b[0], e === "think" ? -2 : b[1]);
    const gx = gaze * 2.6;
    for (const s of [-1, 1]) {
      const x = cx + s * dx;
      if (blink || e === "laugh") { g.beginPath(); g.arc(x, ey + 2, 5, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); continue; }
      if (e === "smile") { g.beginPath(); g.arc(x, ey + 3, 5, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); continue; }
      const ox = (e === "guilty" ? -2 : e === "think" ? 2 : 0) + gx, oy = e === "guilty" ? 2.5 : e === "think" ? -2.5 : 0;
      if (big) { g.fillStyle = "#fff"; g.beginPath(); g.arc(x, ey, 7, 0, Math.PI * 2); g.fill(); g.stroke(); g.fillStyle = "#141821"; g.beginPath(); g.arc(x + gx * 0.6, ey, 2.6, 0, Math.PI * 2); g.fill(); }
      else { g.beginPath(); g.ellipse(x + ox, ey + oy, 3.4, 4.4, 0, 0, Math.PI * 2); g.fill(); }
    }
    if (e === "cry") { g.strokeStyle = "#5aa9ff"; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * dx, ey + 7); g.lineTo(cx + s * dx, ey + 20); g.stroke(); } g.strokeStyle = "#141821"; }
    const open = talk > 0.05 ? 2 + talk * 9 : 0;
    g.beginPath();
    if (open > 0 || e === "shock" || e === "laugh") {
      const ho = Math.max(open, e === "shock" ? 8 : e === "laugh" ? 7 : 0);
      g.fillStyle = "#3a1220";
      g.ellipse(cx, my + 2, e === "shock" ? 6 : 9, ho / 2 + 1, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    } else if (e === "smile") { g.arc(cx, my - 6, 10, Math.PI * 0.2, Math.PI * 0.8); g.stroke(); }
    else if (["frown", "sad", "cry", "angry"].includes(e)) { g.arc(cx, my + 9, 9, Math.PI * 1.2, Math.PI * 1.8); g.stroke(); }
    else if (e === "scared") { g.moveTo(cx - 9, my + 1); for (let i = 0; i <= 6; i++) g.lineTo(cx - 9 + i * 3, my + (i % 2 ? -2 : 2)); g.stroke(); }
    else if (e === "guilty" || e === "think") { g.moveTo(cx - 3, my + 1); g.lineTo(cx + 7, my - 1); g.stroke(); }
    else { g.moveTo(cx - 7, my); g.lineTo(cx + 7, my); g.stroke(); }
    ch.faceTex.needsUpdate = true;
  }

  poseChar(ch, f, t) {
    const [present, x, z, yaw, head, pose, amt, expr, talk, gesture, walk] = f;
    ch.root.visible = !!present;
    if (!present) return;
    const b = this.baked;
    ch.root.position.set(x, 0, z);
    ch.root.rotation.y = yaw;
    const L = ch.legLen;
    // reset
    for (const j of [ch.legL, ch.legR, ch.armL, ch.armR]) { j.rotation.set(0, 0, 0); j.userData.lower.rotation.set(0, 0, 0); }
    ch.spine.rotation.set(0, 0, 0); ch.chest.rotation.set(0, 0, 0); ch.neck.rotation.set(0, 0, 0); ch.head.rotation.set(0, 0, 0); ch.hips.rotation.set(0, 0, 0);
    ch.chest.position.x = 0;
    let lift = 0;
    // seated / kneeling / leaning
    const sitHip = 0.47, kneelHip = L * 0.58;
    if (pose === 1) { ch.legL.rotation.x = ch.legR.rotation.x = -Math.PI / 2 * amt; ch.legL.userData.lower.rotation.x = ch.legR.userData.lower.rotation.x = Math.PI / 2 * amt; }
    if (pose === 2) { ch.legL.rotation.x = -0.2 * amt; ch.legR.rotation.x = -1.4 * amt; ch.legL.userData.lower.rotation.x = 1.7 * amt; ch.legR.userData.lower.rotation.x = 1.5 * amt; }
    if (pose === 3) ch.spine.rotation.x = 0.22 * amt;
    const hipTarget = pose === 1 ? sitHip : pose === 2 ? kneelHip : L;
    // gait (degrees from The Bob's PERFORMANCE layer)
    const w = walk >= 0 ? 1 : 0;
    if (w) {
      const run = false, A = run ? 1.5 : 1, ph = walk * Math.PI * 2, s = Math.sin(ph), c = Math.cos(ph);
      const kl = Math.max(0, c), kr = Math.max(0, -c);
      ch.legL.rotation.x += -26 * s * A * D2R; ch.legR.rotation.x += 26 * s * A * D2R;
      ch.legL.userData.lower.rotation.x += (7 + 46 * kl * kl) * A * D2R; ch.legR.userData.lower.rotation.x += (7 + 46 * kr * kr) * A * D2R;
      ch.hips.rotation.y = 7 * s * D2R; ch.hips.rotation.z = 3.5 * c * D2R;
      ch.spine.rotation.x += 3 * D2R; ch.chest.rotation.y = -9 * s * D2R;
      ch.armL.rotation.x = 22 * s * A * D2R; ch.armR.rotation.x = -22 * s * A * D2R;
      ch.armL.userData.lower.rotation.x = -(16 + 12 * Math.max(0, s)) * D2R; ch.armR.userData.lower.rotation.x = -(16 + 12 * Math.max(0, -s)) * D2R;
      lift = -0.02 + 0.024 * Math.abs(c);
    }
    // idle: breathing and weight shift when still
    const still = 1 - w;
    if (still > 0) {
      const br = Math.sin(t * 1.55 + ch.seed) * still;
      ch.chest.rotation.x += -1.5 * br * D2R;
      ch.armL.rotation.z = (-4 + 1.2 * br) * D2R; ch.armR.rotation.z = (4 - 1.2 * br) * D2R;
      ch.armL.userData.lower.rotation.x = ch.armR.userData.lower.rotation.x = -12 * D2R;
      const ws = Math.sin(t * 0.5 + ch.seed * 2.1) * still * (pose === 1 ? 0.3 : 1);
      ch.hips.rotation.z += 1.4 * ws * D2R; ch.spine.rotation.z = -1.1 * ws * D2R;
      ch.head.rotation.x = Math.sin(t * 0.83 + ch.seed) * 1.6 * D2R;
    }
    ch.hips.position.y = L + (hipTarget - L) * amt + lift;
    // eyeline: split between neck and head, residual goes to the eyes
    const rel = wrap(head - yaw);
    ch.neck.rotation.y = rel * 0.4; ch.head.rotation.y += rel * 0.6;
    // talking: small nods and sways while speaking
    if (talk > 0) { ch.head.rotation.x += (1.5 * talk - 3 * Math.max(0, Math.sin(t * 3.1))) * D2R; ch.head.rotation.y += Math.sin(t * 2.3 + ch.seed * 5) * 3.5 * D2R; ch.head.rotation.z += Math.sin(t * 1.4 + ch.seed * 3) * 2.5 * D2R; }
    // gestures
    const g = gesture >= 0 ? b.gestures[Math.floor(gesture)] : null;
    const p = gesture >= 0 ? gesture - Math.floor(gesture) : 0;
    const arc = Math.sin(p * Math.PI);
    if (g === "nod") ch.neck.rotation.x = Math.sin(p * Math.PI * 4) * 0.25;
    if (g === "shake") ch.neck.rotation.y += Math.sin(p * Math.PI * 4) * 0.35;
    if (g === "shrug") { ch.armL.rotation.z = -0.45 * arc; ch.armR.rotation.z = 0.45 * arc; ch.armL.userData.lower.rotation.x = ch.armR.userData.lower.rotation.x = -1.2 * arc; }
    if (g === "sigh") { ch.chest.rotation.x += 0.12 * arc; ch.neck.rotation.x = 0.2 * arc; }
    if (g === "wave") { ch.armR.rotation.z = 2.5; ch.armR.userData.lower.rotation.z = Math.sin(p * Math.PI * 6) * 0.4; }
    if (g === "point") { ch.armR.rotation.x = -1.45 * Math.min(1, arc * 2); ch.armR.userData.lower.rotation.x = 0; }
    if (g === "reach") { ch.armR.rotation.x = -1.2 * arc; ch.armR.userData.lower.rotation.x = -0.3 * arc; }
    const exprName = b.expressions[expr] ?? "neutral";
    this.drawFace(ch, exprName, talk, g === "blink" || blinkAt(t, ch.seed), clamp(rel / 1.4, -1, 1));
  }

  // ------------------------------------------------------------ frame
  shotAt(t) {
    const s = this.baked.shots;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid].cutStart <= t) lo = mid; else hi = mid - 1; }
    return s[lo];
  }

  frame(t) {
    this.lastT = t;
    if (!this.baked || !this.baked.shots.length) return null;
    const shot = this.shotAt(t);
    if (`${shot.set}|${shot.palette}` !== this.setKey) this.buildSet(shot.set, shot.palette);
    const n = shot.cam.length;
    const k = clamp(Math.floor((t - shot.cutStart) * this.baked.fps + 1e-6), 0, n - 1);
    const c = shot.cam[k];
    this.camera.position.set(c[0], c[1], c[2]);
    this.camera.lookAt(c[3], c[4], c[5]);
    this.camera.fov = c[6];
    this.camera.aspect = 16 / 9;
    this.camera.updateProjectionMatrix();
    const local = shot.trimHead + k / this.baked.fps;
    for (const [id, ch] of Object.entries(this.chars)) {
      const f = shot.chars[id];
      if (f) this.poseChar(ch, f[k], shot.worldStart + local); else ch.root.visible = false;
    }
    const castIds = Object.keys(this.baked.cast);
    for (const [id, mesh] of Object.entries(this.props)) {
      const f = shot.props[id]?.[k];
      if (!f) continue;
      if (mesh.userData.door) { mesh.position.set(f[0] - 0.36, 0.04, f[2]); mesh.rotation.y = f[4] ? -1.7 : 0; continue; }
      mesh.position.set(f[0], f[1] + 0.05, f[2]);
      if (f[3] >= 0) { const holder = this.chars[castIds[f[3]]]; if (holder) mesh.rotation.y = holder.root.rotation.y; }
    }
    this.light(shot);
    this.renderer.render(this.scene, this.camera);
    return { shot, frame: k };
  }

  light(shot) {
    const pal = this.baked.palettes[shot.palette] ?? Object.values(this.baked.palettes)[0];
    const L = LIGHT[shot.light] ?? LIGHT.day;
    const key = new THREE.Color(pal.key);
    if (L.warm > 0) key.lerp(new THREE.Color(0xffc27a), L.warm * 0.6);
    if (L.warm < 0) key.lerp(new THREE.Color(0x8fb3ff), -L.warm * 0.6);
    this.key.color.copy(key);
    this.key.intensity = L.key;
    this.hemi.color.set(pal.key);
    this.hemi.groundColor.set(pal.fill);
    this.hemi.intensity = L.amb;
    this.practical.intensity = L.practical ?? 0;
    if (this.fridgeGlow) this.practical.position.copy(this.fridgeGlow);
  }
}
