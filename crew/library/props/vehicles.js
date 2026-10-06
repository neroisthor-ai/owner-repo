// Vehicles. [Low Pass] pieces are ported from Low Pass (London traffic, river
// boats, the Southeastern train, the F-16 and the B-2) with their dimensions and
// construction; [new] pieces fill gaps. Front faces +z unless noted.
import { THREE, box, canvasTex, cyl, finish, group, instances, mat, mesh, mergeGeometries, rng, TM } from "./core.js";

const M = (c, o = {}) => mat(c, { roughness: 0.8, ...o });

function bodyShape(len, hh, r, y0) {
  const sh = new THREE.Shape();
  sh.moveTo(-len / 2, y0); sh.lineTo(len / 2, y0); sh.lineTo(len / 2, hh - r); sh.quadraticCurveTo(len / 2, hh, len / 2 - r, hh);
  sh.lineTo(-len / 2 + r, hh); sh.quadraticCurveTo(-len / 2, hh, -len / 2, hh - r); sh.closePath();
  return sh;
}
function extrudeBody(g, sh, wd, material) {
  const ge = new THREE.ExtrudeGeometry(sh, { depth: wd, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, curveSegments: 6 });
  ge.translate(0, 0, -wd / 2); ge.rotateY(-Math.PI / 2);
  return mesh(ge, material, g);
}
function wheels(g, w, l, r) {
  const geos = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz]) => new THREE.CylinderGeometry(r, r, 0.3, 12).rotateZ(Math.PI / 2).translate(sx * (w / 2 - 0.1), r, sz * (l / 2 - r * 1.6)));
  mesh(mergeGeometries(geos), M("#111111", { roughness: 0.9 }), g);
}
const glassMat = () => M("#0b1016", { roughness: 0.04, metalness: 0.9 });
const glow = (r, g2, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g2, b) });

/** [Low Pass] London double-decker bus (11.2 m). */
export function bus() {
  const g = new THREE.Group(), w = 2.52, h = 4.38, l = 11.2;
  extrudeBody(g, bodyShape(l, h, 0.55, 0.38), w, M("#b3101a", { roughness: 0.32, metalness: 0.2 }));
  const glass = glassMat();
  box(g, w + 0.03, 1.05, l - 1.2, glass, 0, h - 1.745, -0.1); box(g, w + 0.03, 1.1, l - 3.6, glass, 0, 1.4, -0.9);
  box(g, w - 0.25, 1.0, 0.05, glass, 0, h - 1.72, l / 2 + 0.08); box(g, w - 0.25, 1.5, 0.05, glass, 0, 1.0, l / 2 + 0.08);
  box(g, w + 0.04, 0.4, l - 0.2, M("#151515"), 0, 0.35, 0);
  box(g, 1.5, 0.3, 0.05, glow(2.2, 1.3, 0.2), 0, 2.63, l / 2 + 0.09);
  for (const x of [-0.9, 0.9]) box(g, 0.3, 0.15, 0.05, glow(3, 3, 2.6), x, 0.875, l / 2 + 0.09);
  wheels(g, w, l, 0.5);
  return finish(g, "bus", { length: l });
}

/** [Low Pass] Black cab (4.58 m). */
export function cab() {
  const g = new THREE.Group(), w = 1.85, h = 1.85, l = 4.58;
  const blk = M("#0c0d0f", { roughness: 0.18, metalness: 0.7 });
  extrudeBody(g, bodyShape(l, 1.0, 0.25, 0.3), w, blk);
  extrudeBody(g, bodyShape(l * 0.62, h, 0.35, 0.9), w * 0.94, blk).position.z = -0.25;
  box(g, w * 0.95, 0.5, l * 0.58, glassMat(), 0, 1.25, -0.25);
  box(g, 0.6, 0.16, 0.3, glow(2.4, 1.6, 0.3), 0, h, 0.4);
  wheels(g, w, l, 0.34);
  return finish(g, "cab", { length: l });
}

/** [Low Pass] White panel van (5.6 m). */
export function van() {
  const g = new THREE.Group(), w = 2.0, h = 2.4, l = 5.6;
  extrudeBody(g, bodyShape(l, h, 0.35, 0.3), w, M("#e9e9e6", { roughness: 0.35, metalness: 0.3 }));
  box(g, w - 0.1, 0.7, 0.05, glassMat(), 0, 1.35, l / 2 + 0.07); box(g, w + 0.02, 0.6, 1.2, glassMat(), 0, 1.45, l / 2 - 0.6);
  wheels(g, w, l, 0.34);
  return finish(g, "van", { length: l });
}

const CAR_COLOURS = ["#9ba3aa", "#20262c", "#5c6770", "#d6d6d2", "#2d4a6b", "#6b1d1d", "#3d4a3a"];
/** [Low Pass] Saloon car (4.5 m). colour: hex or a seed for the film's palette. */
export function car({ color = null, seed = 1 } = {}) {
  const g = new THREE.Group(), w = 1.82, h = 1.45, l = 4.5;
  const c = M(color ?? rng(seed).pick(CAR_COLOURS), { roughness: 0.22, metalness: 0.75 });
  extrudeBody(g, bodyShape(l, 0.95, 0.3, 0.3), w, c);
  extrudeBody(g, bodyShape(l * 0.55, h, 0.35, 0.85), w * 0.9, c).position.z = -0.2;
  box(g, w * 0.92, 0.42, l * 0.5, glassMat(), 0, 0.94, -0.2);
  for (const x of [-0.6, 0.6]) box(g, 0.25, 0.1, 0.04, glow(3, 3, 2.6), x, 0.62, l / 2 + 0.05);
  for (const x of [-0.6, 0.6]) box(g, 0.25, 0.1, 0.04, glow(2.5, 0.1, 0.1), x, 0.68, -l / 2 - 0.05);
  wheels(g, w, l, 0.34);
  return finish(g, "car", { length: l });
}

/** [Low Pass] Thames river cruiser. big:true = 38 m, else 24 m. Bow toward +x. */
export function river_boat({ big = false } = {}) {
  const g = new THREE.Group(), L = big ? 38 : 24;
  box(g, L, 2.4, big ? 8 : 6, M("#f0f0ec", { roughness: 0.5 }), 0, 0, 0);
  const cw = canvasTex(128, 128, (c, w, h) => { c.fillStyle = "#e6e6e6"; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) { const v = 140; c.fillStyle = `rgb(${v},${v},${v + 6})`; c.fillRect(x + 2, y + 4, 28, 25); } }, { repeat: [4, 1] });
  box(g, L * 0.62, 2.4, big ? 7 : 5, new THREE.MeshStandardMaterial({ color: "#1f2830", map: cw, roughness: 0.14, metalness: 0.8 }), -L * 0.05, 2.4, 0);
  box(g, L * 0.62, 0.3, big ? 7.4 : 5.4, M("#1d4e89", { roughness: 0.5 }), -L * 0.05, 4.8, 0);
  return finish(g, "river_boat", { length: L });
}

/** [Low Pass] Southeastern electric multiple unit: n carriages of 20 m, cab at +z. */
export function train({ cars = 1 } = {}) {
  const g = new THREE.Group(), L = 20;
  const white = M("#d9dde0", { roughness: 0.3, metalness: 0.35 }), blue = M("#16306e", { roughness: 0.4 }), yel = M("#f2c318", { roughness: 0.4 }), gl = glassMat(), dk = M("#2a2c30", { roughness: 0.7 });
  for (let k = 0; k < cars; k++) {
    const z = -k * (L + 0.8);
    const sh = new THREE.Shape(); sh.moveTo(-L / 2, 0.6); sh.lineTo(L / 2, 0.6); sh.lineTo(L / 2, 3.4); sh.quadraticCurveTo(L / 2, 3.85, L / 2 - 0.6, 3.85); sh.lineTo(-L / 2 + 0.6, 3.85); sh.quadraticCurveTo(-L / 2, 3.85, -L / 2, 3.4); sh.closePath();
    const ge = new THREE.ExtrudeGeometry(sh, { depth: 2.8, bevelEnabled: false, curveSegments: 5 }); ge.translate(0, 0, -1.4); ge.rotateY(-Math.PI / 2);
    mesh(ge, white, g, 0, 0, z);
    box(g, 2.84, 0.9, L - 2, gl, 0, 1.9, z); box(g, 2.84, 0.9, L - 0.4, blue, 0, 0.65, z); box(g, 2.4, 0.6, L - 3, dk, 0, 0.05, z);
    if (k === 0) {
      box(g, 2.7, 2.2, 0.3, yel, 0, 0.7, z + L / 2 + 0.1); box(g, 2.2, 0.9, 0.1, gl, 0, 2.15, z + L / 2 + 0.27);
      for (const sx of [-0.9, 0.9]) box(g, 0.3, 0.18, 0.05, glow(4, 4, 3.6), sx, 1.11, z + L / 2 + 0.27);
    }
  }
  return finish(g, "train", { length: cars * 20.8 });
}

/** [new] Bicycle (1.75 m). */
export function bicycle({ color = "#2a5a8a" } = {}) {
  const g = new THREE.Group();
  const tyre = M("#151515", { roughness: 0.9 }), frame = M(color, { roughness: 0.35, metalness: 0.6 });
  for (const z of [-0.52, 0.52]) { const w = mesh(new THREE.TorusGeometry(0.33, 0.02, 8, 32), tyre, g, 0, 0.35, z); w.rotation.y = Math.PI / 2; }
  const tube = (a, b, r = 0.016) => { const d = new THREE.Vector3().subVectors(b, a); const m = mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), frame, g); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); };
  const V = (y, z) => new THREE.Vector3(0, y, z);
  tube(V(0.35, -0.52), V(0.62, -0.12)); tube(V(0.35, -0.52), V(0.36, 0.0)); tube(V(0.36, 0.0), V(0.62, -0.12)); tube(V(0.36, 0.0), V(0.8, 0.38)); tube(V(0.62, -0.12), V(0.8, 0.38)); tube(V(0.35, 0.52), V(0.8, 0.38));
  tube(V(0.62, -0.12), V(0.85, -0.18)); box(g, 0.1, 0.04, 0.22, M("#1a1a1a"), 0, 0.85, -0.2);
  box(g, 0.5, 0.025, 0.025, M("#1a1a1a"), 0, 0.92, 0.4);
  return finish(g, "bicycle", { length: 1.75 });
}

// ---------------------------------------------------------------- aircraft [Low Pass]

let panelCache = {};
function panelTex(base, seam, scratch, seed) {
  const k = `${base}${seed}`;
  if (panelCache[k]) return panelCache[k];
  const r = rng(seed);
  return (panelCache[k] = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 180; i++) { c.fillStyle = `rgba(0,0,0,${0.02 + r() * 0.05})`; c.beginPath(); c.ellipse(r() * w, r() * h, 8 + r() * 60, 6 + r() * 40, r() * 3, 0, 6.3); c.fill(); }
    for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.04})`; c.fillRect(r() * w, r() * h, 1 + r() * 2, 30 + r() * 120); }
    c.strokeStyle = seam; c.lineWidth = 1.3;
    for (let i = 0; i < 46; i++) { const x = r() * w, y = r() * h, ww = 30 + r() * 140, hh = 24 + r() * 110; c.strokeRect(x, y, ww, hh); c.fillStyle = seam; for (let k2 = 0; k2 < ww; k2 += 7) c.fillRect(x + k2, y + 3, 1.2, 1.2); }
    c.strokeStyle = scratch; c.lineWidth = 0.7;
    for (let i = 0; i < 220; i++) { const x = r() * w, y = r() * h, a = r() * 6.3, l = 3 + r() * 18; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
  }, { repeat: [1, 1] }));
}
const rep = (t, x, y) => { const c = t.clone(); c.repeat.set(x, y); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.needsUpdate = true; return c; };

const NOISE = `float h13(vec3 p){p=fract(p*0.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float vn3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(h13(i),h13(i+vec3(1,0,0)),f.x),mix(h13(i+vec3(0,1,0)),h13(i+vec3(1,1,0)),f.x),f.y),mix(mix(h13(i+vec3(0,0,1)),h13(i+vec3(1,0,1)),f.x),mix(h13(i+vec3(0,1,1)),h13(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm3(vec3 p){float a=0.5,s=0.0;for(int i=0;i<4;i++){s+=a*vn3(p);p*=2.03;a*=0.5;}return s;}`;

/** [Low Pass] Afterburner plume shader material. uniforms.uTime, uAmt. */
export function plumeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAmt: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: "varying vec2 vUv;varying float vF;void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.0);vec3 n=normalize(mat3(modelMatrix)*normal);vF=abs(dot(n,normalize(cameraPosition-w.xyz)));gl_Position=projectionMatrix*viewMatrix*w;}",
    fragmentShader: `uniform float uTime,uAmt;varying vec2 vUv;varying float vF;${NOISE}
void main(){float l=vUv.y;float fl=0.75+0.25*vn3(vec3(vUv.x*6.0,l*8.0-uTime*40.0,uTime*9.0));
vec3 core=vec3(0.55,0.72,1.6);vec3 mid=vec3(2.4,1.1,0.35);vec3 tip=vec3(0.9,0.28,0.05);vec3 c=mix(core,mid,smoothstep(0.0,0.3,l));c=mix(c,tip,smoothstep(0.35,1.0,l));
float dia=0.5+0.5*sin(l*38.0);c+=vec3(1.2,0.8,0.5)*pow(dia,6.0)*smoothstep(0.55,0.05,l)*0.9;float a=pow(vF,1.4)*(1.0-smoothstep(0.55,1.0,l))*fl*uAmt;gl_FragColor=vec4(c,clamp(a,0.0,1.0));}`,
  });
}

/** [Low Pass] Condensation vapour shader. mode 0: cone around the nose, 1: over the wings. uniforms.uTime, uAmt. */
export function vaporMaterial(mode = 0) {
  return new THREE.ShaderMaterial({
    defines: { MODE: mode }, uniforms: { uTime: { value: 0 }, uAmt: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: "varying vec2 vUv;varying vec3 vL;varying vec3 vN;varying vec3 vV;void main(){vUv=uv;vL=position;vec4 w=modelMatrix*vec4(position,1.0);vN=normalize(mat3(modelMatrix)*normal);vV=normalize(cameraPosition-w.xyz);gl_Position=projectionMatrix*viewMatrix*w;}",
    fragmentShader: `uniform float uTime,uAmt;varying vec2 vUv;varying vec3 vL;varying vec3 vN;varying vec3 vV;${NOISE}
void main(){float a=0.0;vec3 col=vec3(1.0,0.93,0.84);
#if MODE==0
float fr=pow(1.0-abs(dot(normalize(vN),normalize(vV))),1.3);float n=fbm3(vec3(vL.x*1.6,vL.y*1.6,vL.z*0.7+uTime*16.0));float prof=smoothstep(1.0,0.86,vUv.y)*smoothstep(0.0,0.65,vUv.y);a=uAmt*prof*(0.2+0.8*fr)*smoothstep(0.3,0.75,n)*0.95;
#else
float n=fbm3(vec3(vL.x*1.3,vL.z*0.4+uTime*11.0,uTime*0.7));a=uAmt*smoothstep(0.38,0.82,n)*0.75;
#endif
gl_FragColor=vec4(col,a);}`,
  });
}

/** [Low Pass] F-16 (15 m) with pilot, afterburner, vapour and nav lights. Nose toward +z.
 *  userData.update(t, {burn, vapor}) animates the plume, vapour and strobes. */
export function f16({ burner = true } = {}) {
  const g = new THREE.Group();
  const tex = panelTex("#b9bcbf", "rgba(40,44,48,0.55)", "rgba(235,238,240,0.35)", 11);
  const paint = new THREE.MeshStandardMaterial({ color: "#6f777f", map: rep(tex, 3, 2), roughness: 0.5, metalness: 0.35 });
  const paintM = new THREE.MeshStandardMaterial({ color: "#6f777f", map: rep(tex, 0.14, 0.14), roughness: 0.5, metalness: 0.35 });
  const dark = M("#2b2c2e", { roughness: 0.6, metalness: 0.4 }), white = M("#dadcd8", { roughness: 0.45 });
  const P = [[0, 7.6], [0.18, 7.1], [0.38, 6.3], [0.55, 5.3], [0.68, 4.2], [0.76, 2.8], [0.8, 1.0], [0.8, -2.0], [0.76, -4.5], [0.68, -6.0], [0.58, -6.9], [0.56, -7.0]].map((p) => new THREE.Vector2(p[0], p[1]));
  const fus = new THREE.LatheGeometry(P, 28); fus.rotateX(Math.PI / 2); fus.scale(1.08, 0.9, 1);
  mesh(fus, paint, g);
  const spine = mesh(new THREE.SphereGeometry(1, 20, 12), paint, g, 0, 0.55, -0.8); spine.scale.set(0.48, 0.38, 3.4);
  const intake = mesh(new THREE.CylinderGeometry(0.56, 0.64, 3.4, 18, 1, true).rotateX(Math.PI / 2), paint, g, 0, -0.8, 1.1); intake.scale.set(1.15, 0.72, 1);
  const ib = mesh(new THREE.CircleGeometry(0.54, 18), new THREE.MeshBasicMaterial({ color: 0x050505 }), g, 0, -0.8, 2.75); ib.scale.set(1.15, 0.72, 1);
  const flat = (pts, mirror, depth, y, m) => { const sh = new THREE.Shape(pts.map((p) => new THREE.Vector2(mirror ? -p[0] : p[0], p[1]))); const ge = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 }); ge.rotateX(Math.PI / 2); ge.translate(0, y + depth / 2, 0); mesh(ge, m, g); };
  const WING = [[0.6, 4.9], [1.0, 2.2], [4.95, -1.5], [4.95, -2.6], [0.6, -3.4]], STAB = [[0.5, -4.9], [2.9, -6.4], [2.9, -7.2], [0.5, -7.3]];
  for (const mir of [false, true]) { flat(WING, mir, 0.12, -0.12, paintM); flat(STAB, mir, 0.08, -0.25, paintM); }
  const fin = new THREE.ExtrudeGeometry(new THREE.Shape([[-3.6, 0.5], [-6.0, 3.7], [-6.9, 3.7], [-7.1, 0.5]].map((p) => new THREE.Vector2(p[0], p[1]))), { depth: 0.14, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
  fin.rotateY(-Math.PI / 2); fin.translate(0.07, 0, 0); mesh(fin, paintM, g);
  for (const s of [-1, 1]) {
    mesh(new THREE.CylinderGeometry(0.065, 0.065, 2.9, 8).rotateX(Math.PI / 2), white, g, s * 5.02, -0.02, -1.4);
    const tank = mesh(new THREE.SphereGeometry(1, 12, 8), paint, g, s * 2.4, -0.65, -0.6); tank.scale.set(0.3, 0.3, 1.8);
    const vf = mesh(new THREE.BoxGeometry(0.05, 0.55, 1.3), paint, g, s * 0.55, -0.8, -5.1); vf.rotation.z = s * 0.45;
    mesh(new THREE.ConeGeometry(0.065, 0.4, 8).rotateX(Math.PI / 2), white, g, s * 5.02, -0.02, 0.25);
    mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.6, 8).rotateX(Math.PI / 2), white, g, s * 3.4, -0.62, -0.9);
    mesh(new THREE.ConeGeometry(0.09, 0.4, 8).rotateX(Math.PI / 2), white, g, s * 3.4, -0.62, 1.1);
    mesh(new THREE.BoxGeometry(0.08, 0.35, 1.3), paint, g, s * 3.4, -0.33, -1.0);
  }
  mesh(new THREE.CylinderGeometry(0.02, 0.035, 0.9, 6).rotateX(Math.PI / 2), dark, g, 0, 0, 8.0);
  mesh(new THREE.CylinderGeometry(0.5, 0.57, 1.3, 22, 1, true).rotateX(Math.PI / 2), M("#2c231c", { roughness: 0.45, metalness: 0.85 }), g, 0, 0, -7.55);
  const nozGlow = mesh(new THREE.CircleGeometry(0.48, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 1.3, 0.45), toneMapped: false }), g, 0, 0, -7.7); nozGlow.rotation.y = Math.PI;
  const canopy = mesh(new THREE.SphereGeometry(1, 28, 16), new THREE.MeshStandardMaterial({ color: "#9b8a5c", roughness: 0.03, metalness: 0.9, transparent: true, opacity: 0.55 }), g, 0, 0.64, 3.4); canopy.scale.set(0.44, 0.64, 1.8);
  mesh(new THREE.SphereGeometry(0.17, 16, 12), M("#dedad2", { roughness: 0.5 }), g, 0, 0.98, 3.25);
  mesh(new THREE.SphereGeometry(0.175, 16, 12, -0.9, 1.8, 0.9, 1.0), M("#ffc55a", { roughness: 0.02, metalness: 1 }), g, 0, 0.98, 3.25);
  const plume = plumeMaterial();
  const pl = mesh(new THREE.ConeGeometry(0.5, 7.5, 24, 1, true).rotateX(-Math.PI / 2), plume, g, 0, 0, -11.55); pl.renderOrder = 5; pl.visible = burner; pl.castShadow = false;
  const pl2 = mesh(new THREE.ConeGeometry(0.36, 3.4, 20, 1, true).rotateX(-Math.PI / 2), plume, g, 0, 0, -9.5); pl2.renderOrder = 6; pl2.visible = burner; pl2.castShadow = false;
  const light = new THREE.PointLight(new THREE.Color(1.0, 0.55, 0.2), burner ? 2.2 : 0, 60, 2); light.position.set(0, 0, -10); g.add(light);
  const vc = vaporMaterial(0), vw = vaporMaterial(1);
  const cone = mesh(new THREE.CylinderGeometry(1.1, 3.2, 4.6, 40, 6, true).rotateX(Math.PI / 2), vc, g, 0, 0.1, 0.3); cone.renderOrder = 7; cone.castShadow = false;
  for (const mir of [false, true]) { const ge = new THREE.ShapeGeometry(new THREE.Shape(WING.map((p) => new THREE.Vector2(mir ? -p[0] : p[0], p[1])))); ge.rotateX(Math.PI / 2); ge.translate(0, 0.14, 0); const me = mesh(ge, vw, g); me.renderOrder = 7; me.castShadow = false; }
  const nav = [];
  const navLight = (x, y, z, c, strobe, sz = 0.12) => { const m = new THREE.Mesh(new THREE.SphereGeometry(sz, 8, 6), new THREE.MeshBasicMaterial({ color: c.clone() })); m.position.set(x, y, z); g.add(m); nav.push({ m, c, strobe }); };
  navLight(5.05, 0, -2.0, new THREE.Color(6, 0.2, 0.1), false); navLight(-5.05, 0, -2.0, new THREE.Color(0.2, 6, 0.8), false); navLight(0, 3.75, -6.95, new THREE.Color(8, 8, 8), true, 0.1); navLight(0, -0.95, -1, new THREE.Color(8, 0.4, 0.2), true, 0.1);
  g.userData.tips = [new THREE.Vector3(5.05, 0, -2.1), new THREE.Vector3(-5.05, 0, -2.1)];
  g.userData.update = (t, { burn = 1, vapor = 0 } = {}) => {
    const b = burn * (0.8 + 0.2 * Math.sin(t * 37) * Math.sin(t * 23.3));
    plume.uniforms.uTime.value = t; plume.uniforms.uAmt.value = b; light.intensity = 2.2 * b;
    vc.uniforms.uTime.value = t; vc.uniforms.uAmt.value = vapor; vw.uniforms.uTime.value = t; vw.uniforms.uAmt.value = vapor;
    for (const n of nav) n.m.material.color.copy(n.c).multiplyScalar(n.strobe ? (((t * 1.1) % 1) < 0.05 ? 1 : 0) : 1);
  };
  g.userData.update(0);
  return finish(g, "f16", { length: 15.6, span: 10 });
}

const B2_POLY = [[0, 11.4], [-26.2, -5.9], [-25.8, -7.0], [-17.5, -2.4], [-10.5, -8.2], [-5.2, -3.6], [0, -8.6], [5.2, -3.6], [10.5, -8.2], [17.5, -2.4], [25.8, -7.0], [26.2, -5.9]];

/** [Low Pass] B-2 Spirit (52 m span): sculpted flying-wing surfaces clipped to the real planform. */
export function b2() {
  const g = new THREE.Group();
  const tex = panelTex("#c8c8ca", "rgba(30,30,32,0.6)", "rgba(255,255,255,0.55)", 23);
  const base = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.085, 0.087, 0.095), map: rep(tex, 5, 2), roughnessMap: rep(tex, 5, 2), roughness: 0.62, metalness: 0.25 });
  const poly = B2_POLY, polyV = poly.map((p) => new THREE.Vector2(p[0], p[1]));
  const inPoly = (x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const segD = (x, z) => { let d = 1e9; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; const vx = b[0] - a[0], vz = b[1] - a[1]; const t = Math.min(1, Math.max(0, ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz))); d = Math.min(d, Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t)); } return d; };
  const surf = (top) => {
    const ge = new THREE.PlaneGeometry(54, 21, 180, 72); ge.rotateX(top ? -Math.PI / 2 : Math.PI / 2); ge.translate(0, 0, 1.4);
    const pos = ge.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i); let y = 0;
      if (inPoly(x, z)) { const e = Math.pow(Math.min(1, Math.max(0, segD(x, z) / 3.4)), 0.55), ax = Math.abs(x);
        if (top) y = e * (0.35 + 1.35 * Math.pow(1 - Math.min(1, ax / 26.5), 1.4)) + 1.45 * Math.exp(-(x * x / 7 + (z - 4.2) * (z - 4.2) / 24)) * e + 0.8 * Math.exp(-((ax - 5.2) * (ax - 5.2) / 3 + (z + 0.3) * (z + 0.3) / 16)) * e;
        else y = -e * (0.25 + 0.75 * (1 - Math.min(1, ax / 26.5))); }
      pos.setY(i, y);
    }
    ge.computeVertexNormals();
    const m = base.clone();
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uPoly = { value: polyV };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vPl;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvPl=position.xz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vPl;uniform vec2 uPoly[12];\nbool inPoly(vec2 p){bool c=false;vec2 b=uPoly[11];for(int i=0;i<12;i++){vec2 a=uPoly[i];if(((a.y>p.y)!=(b.y>p.y))&&(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x))c=!c;b=a;}return c;}").replace("void main() {", "void main() {\nif(!inPoly(vPl))discard;");
    };
    m.customProgramCacheKey = () => "b2";
    mesh(ge, m, g);
  };
  surf(true); surf(false);
  const blk = M("#040405", { roughness: 0.3, metalness: 0.5 });
  for (const s of [-1, 1]) { const intake = mesh(new THREE.BoxGeometry(2.4, 0.35, 0.9), blk, g, s * 5.2, 1.35, 2.2); intake.rotation.y = s * 0.35; mesh(new THREE.BoxGeometry(2.2, 0.12, 3.2), blk, g, s * 5.4, 0.62, -4.2); }
  for (let k = 0; k < 4; k++) { const w = mesh(new THREE.PlaneGeometry(0.9, 0.5), blk, g, -1.35 + k * 0.9, 2.05, 7.1); w.rotation.x = -0.95; w.rotation.y = (k < 2 ? 1 : -1) * 0.15; }
  g.userData.tips = [new THREE.Vector3(26.0, 0.05, -6.4), new THREE.Vector3(-26.0, 0.05, -6.4)];
  return finish(g, "b2", { length: 20, span: 52.4 });
}
