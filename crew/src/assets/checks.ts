// Code-side checks on a built prop: size, grounding, centring, budgets, label, inside-out surfaces, floating parts.
// The failures are worded for the model that wrote the prop, so they go straight back in a repair prompt.
import * as THREE from "three";

export interface PropSpec {
  id: string;
  /** metres [w, h, d] */
  size?: [number, number, number];
  tolerance?: number;
  placement?: string;
  maxTris?: number;
  maxMaterials?: number;
}
export interface Check { name: string; pass: boolean; detail: string }
export interface Measured { size: [number, number, number]; y0: number; center: [number, number]; tris: number; materials: number }
export interface PropCheck { pass: boolean; checks: Check[]; measured: Measured; failures: string[] }

const cm = (v: number) => `${(v * 100).toFixed(1)} cm`;
const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
const HUNG = new Set(["wall", "ceiling"]);

const meshesOf = (g: THREE.Object3D) => { const out: THREE.Mesh[] = []; g.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };
const matsOf = (m: THREE.Mesh) => ([] as THREE.Material[]).concat(m.material);
export const colourOf = (m: THREE.Mesh) => { const c = (matsOf(m)[0] as THREE.MeshStandardMaterial | undefined)?.color; return c?.getHexString ? `#${c.getHexString()}` : "no colour"; };

function triCount(m: THREE.Mesh): number {
  const geo = m.geometry, n = geo.index ? geo.index.count : geo.attributes.position?.count ?? 0;
  return (n / 3) * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
}

/** Area-weighted mean over faces of dot(face normal, unit vector from the mesh centroid to the face), in world space. +1 outward, -1 inside out. */
export function outwardness(m: THREE.Mesh): number | null {
  const pos = m.geometry.attributes.position, idx = m.geometry.index;
  if (!pos || pos.count < 3) return null;
  const n = idx ? idx.count : pos.count;
  const flip = m.matrixWorld.determinant() < 0 ? -1 : 1; // a mirrored mesh renders with flipped winding
  const v = (i: number, out: THREE.Vector3) => out.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const faces: { n: THREE.Vector3; c: THREE.Vector3; area: number }[] = [];
  const mc = new THREE.Vector3();
  let total = 0;
  for (let i = 0; i + 2 < n; i += 3) {
    v(i, a); v(i + 1, b); v(i + 2, c);
    const nrm = e1.subVectors(b, a).cross(e2.subVectors(c, a));
    const area = nrm.length() / 2;
    if (!(area > 1e-12)) continue;
    const cen = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    faces.push({ n: nrm.clone().normalize().multiplyScalar(flip), c: cen, area });
    mc.addScaledVector(cen, area); total += area;
  }
  if (!faces.length) return null;
  mc.multiplyScalar(1 / total);
  let s = 0;
  const d = new THREE.Vector3();
  for (const f of faces) { d.subVectors(f.c, mc); const len = d.length(); if (len > 1e-9) s += f.area * f.n.dot(d) / len; }
  return s / total;
}

/** Distance between two boxes (0 when they touch or overlap). */
const gapBetween = (a: THREE.Box3, b: THREE.Box3) => Math.hypot(Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x), Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y), Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z));

export const INSIDE_OUT_AT = -0.3;

export function checkProp(group: THREE.Group, spec: PropSpec): PropCheck {
  const checks: Check[] = [];
  const ck = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
  const tol = spec.tolerance ?? 0.12, maxTris = spec.maxTris ?? 20000, maxMats = spec.maxMaterials ?? 8;
  const empty: Measured = { size: [0, 0, 0], y0: 0, center: [0, 0], tris: 0, materials: 0 };
  const done = (measured: Measured): PropCheck => {
    const failures = checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`);
    return { pass: failures.length === 0, checks, measured, failures };
  };
  if (!group || (group as THREE.Group).isGroup !== true) { ck("returns a group", false, "the builder did not return a THREE.Group"); return done(empty); }
  ck("returns a group", true, "ok");

  group.updateMatrixWorld(true);
  const meshes = meshesOf(group);
  let nan = false, tris = 0;
  const mats = new Set<THREE.Material>();
  for (const m of meshes) {
    const arr = m.geometry.attributes.position?.array;
    if (arr) for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) { nan = true; break; }
    tris += triCount(m);
    for (const x of matsOf(m)) mats.add(x);
  }
  const bb = new THREE.Box3().setFromObject(group);
  const finite = [bb.min, bb.max].every((p) => Number.isFinite(p.x + p.y + p.z));
  ck("has geometry", meshes.length > 0 && finite, meshes.length ? `${meshes.length} meshes` : "the group contains no meshes");
  ck("no NaN", !nan && finite, nan || !finite ? "some vertex positions are NaN or infinite (check divisions, sqrt of negatives, bad radii)" : "ok");
  if (!meshes.length || !finite) return done({ ...empty, tris: Math.round(tris), materials: mats.size });

  const size = bb.getSize(new THREE.Vector3()), cen = bb.getCenter(new THREE.Vector3());
  const measured: Measured = { size: [r3(size.x), r3(size.y), r3(size.z)], y0: r3(bb.min.y), center: [r3(cen.x), r3(cen.z)], tris: Math.round(tris), materials: mats.size };

  if (spec.size) {
    const names = ["width (x)", "height (y)", "depth (z)"];
    const bad: string[] = [];
    spec.size.forEach((want, i) => {
      const got = size.getComponent(i), slack = Math.max(want * tol, 0.005);
      if (Math.abs(got - want) > slack) bad.push(`${names[i]} is ${cm(got)}, wanted ${cm(want)} (within ${Math.round(tol * 100)}%)`);
    });
    ck("size", bad.length === 0, bad.length ? bad.join("; ") : `${cm(size.x)} x ${cm(size.y)} x ${cm(size.z)}`);
  }
  if (!HUNG.has(spec.placement ?? "")) ck("stands on y=0", Math.abs(bb.min.y) <= 0.003, Math.abs(bb.min.y) <= 0.003 ? "ok" : `the lowest point is at y=${cm(bb.min.y)}; it must be 0 (move everything ${bb.min.y > 0 ? "down" : "up"} by ${cm(Math.abs(bb.min.y))})`);
  const offX = cen.x, offZ = cen.z;
  ck("centred on x and z", Math.abs(offX) <= 0.01 && Math.abs(offZ) <= 0.01, Math.abs(offX) <= 0.01 && Math.abs(offZ) <= 0.01 ? "ok" : `the bounding box centre is at x=${cm(offX)}, z=${cm(offZ)}; shift the parts by x ${cm(-offX)}, z ${cm(-offZ)} so it is centred on 0`);
  ck("triangle budget", tris <= maxTris, tris <= maxTris ? `${Math.round(tris)}` : `${Math.round(tris)} triangles, at most ${maxTris} (lower the segment counts)`);
  ck("material budget", mats.size <= maxMats, mats.size <= maxMats ? `${mats.size}` : `${mats.size} materials, at most ${maxMats} (reuse materials)`);
  const label = (group.userData as { prop?: { id?: string } }).prop?.id;
  ck("label", label === spec.id, label === spec.id ? "ok" : `the group must be labelled with return finish(g, "${spec.id}", {...})${label ? ` (it says "${label}")` : ""}`);

  // inside-out surfaces: faces wind the wrong way, so the default FrontSide material culls them and the part is invisible
  const inside: string[] = [];
  meshes.forEach((m, i) => {
    if (matsOf(m).some((x) => x.side === THREE.DoubleSide || x.side === THREE.BackSide)) return;
    const o = outwardness(m);
    if (o !== null && o < INSIDE_OUT_AT) inside.push(`mesh ${i} (colour ${colourOf(m)}, ${cm(new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()).length())} across): faces point inward (inside out): reverse the point order or use side: THREE.DoubleSide`);
  });
  ck("no inside-out surfaces", inside.length === 0, inside.length ? inside.join("; ") : "ok");

  // floating parts
  if (meshes.length > 1) {
    const boxes = meshes.map((m) => new THREE.Box3().setFromObject(m));
    const far: string[] = [];
    boxes.forEach((b, i) => {
      if (b.isEmpty()) return;
      const gap = Math.min(...boxes.map((o, j) => (j === i || o.isEmpty() ? Infinity : gapBetween(b, o))));
      if (gap > 0.02) far.push(`mesh ${i} (colour ${colourOf(meshes[i])}) is ${cm(gap)} away from every other part`);
    });
    ck("no floating parts", far.length === 0, far.length ? `${far.join("; ")}: attach it to the rest` : "ok");
  }
  return done(measured);
}

/** Plain-language list of what failed, for the repair prompt. */
export const failureText = (r: PropCheck) => r.failures.map((f) => `- ${f}`).join("\n");

/** A structured description of the built prop for a reviewer that cannot see it. */
export function describeProp(group: THREE.Group, measured: Measured): string {
  group.updateMatrixWorld(true);
  const parts = meshesOf(group).slice(0, 60).map((m, i) => {
    const b = new THREE.Box3().setFromObject(m), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    return `- part ${i}: colour ${colourOf(m)}, size ${cm(s.x)} x ${cm(s.y)} x ${cm(s.z)}, centre (x ${cm(c.x)}, y ${cm(c.y)}, z ${cm(c.z)}), x from ${cm(b.min.x)} to ${cm(b.max.x)}, y from ${cm(b.min.y)} to ${cm(b.max.y)}`;
  });
  const [w, h, d] = measured.size;
  return `Measured: ${cm(w)} wide (x), ${cm(h)} tall (y), ${cm(d)} deep (z); lowest point y=${cm(measured.y0)}; ${measured.tris} triangles; ${measured.materials} materials. +x is right, +z is the front.\nParts:\n${parts.join("\n")}`;
}
