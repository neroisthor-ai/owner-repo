// Set geometry, computed once on the server. The framing solver keeps the lens
// out of it, QC checks bodies and eyelines against it, and the browser draws
// exactly these boxes, so previs and checks can never disagree.

import type { SetDef } from "./ast.ts";
import { FURNITURE } from "./registry.ts";
import { PROP_META } from "../../library/props/meta.js";

export const WALL_HEIGHT = 2.7;
/** extra metres of free space round an open set's rectangle, and its ceiling */
export const OPEN_PAD = 15;
export const OPEN_HEIGHT = 80;

/** The words SCENE's legacy `is <furniture>` knew, and the library prop that draws each one. */
export const FURNITURE_PROP: Record<string, string> = {
  counter: "kitchen_counter", fridge: "fridge", table: "dining_table", sofa: "sofa", bed: "bed_boarding", desk: "office_desk",
  window: "window_barred", door: "door", chair: "chair_wood", sink: "sink_unit", stove: "stove", shelf: "bookshelf", tv: "tv_stand",
};

export interface FurnitureSpec {
  /** footprint and height of the obstacle box */
  w: number; d: number; h: number;
  /** elevation of the box bottom */
  y0: number;
  placement: "front" | "at" | "behind" | "wall" | "ceiling" | "onSurface" | "flat";
  sittable: boolean;
  solid: boolean;
  decor: boolean;
  /** height of the usable top (what a prop dressed `on` this sits at) */
  surface: number;
  /** library prop that draws it, or null (stairs) */
  prop: string | null;
}

/** Everything the compiler and QC need to know about a furniture word: a legacy word (kept exactly as it was) or any library prop id. */
export function furnitureSpec(kind: string): FurnitureSpec | null {
  const legacy = FURNITURE[kind];
  const prop = FURNITURE_PROP[kind] ?? (PROP_META[kind] ? kind : null);
  if (legacy) {
    const sittable = kind === "chair" || kind === "sofa" || kind === "bed";
    const wallish = kind === "door" || kind === "window";
    return {
      w: legacy.w, d: legacy.d, h: kind === "window" ? 1.2 : legacy.h, y0: kind === "window" ? 0.9 : 0,
      placement: sittable ? "at" : wallish ? "behind" : "front", sittable, solid: !wallish, decor: false, surface: legacy.h, prop,
    };
  }
  const m = PROP_META[kind];
  if (!m) return null;
  const solid = !m.decor && m.placement !== "behind";
  return {
    w: m.size[0], d: m.size[2], h: Math.max(m.size[1], 0.01), y0: Math.max(m.y0, 0), placement: m.placement,
    sittable: !!m.sittable, solid, decor: !!m.decor, surface: m.surface ?? m.size[1], prop: kind,
  };
}

/** Height to aim at on a piece of furniture (80% of a floor-standing piece, the middle of a hung one). */
export function aimHeight(kind: string): number | null {
  const f = furnitureSpec(kind);
  return f ? (f.y0 > 0.3 ? f.y0 + f.h / 2 : f.h * 0.8) : null;
}

/** Height of the top of a piece of furniture: where a prop put on it rests (the middle of a hung one). */
export function topHeight(kind: string): number | null {
  const f = furnitureSpec(kind);
  return f ? (f.y0 > 0.3 ? f.y0 + f.h / 2 : f.surface) : null;
}

/** Is this a word `anchor ... is <x>` or `dress <x>` may use? */
export const isFurniture = (kind: string) => !!(FURNITURE[kind] || PROP_META[kind]);

export interface Box {
  id: string; // anchor id (or the dressing's id)
  kind: string; // furniture word or library prop id
  prop: string | null; // library prop that draws it
  cx: number; cy: number; cz: number; // centre
  w: number; h: number; d: number; // size along local x, y, z
  yaw: number; // rotation about y used by the geometry tests
  ry: number; // rotation about y for the model: its front faces +z at ry=0
  y: number; // elevation of the model's origin
  sittable: boolean;
  solid: boolean; // blocks bodies (doors, windows and small props don't)
  decor: boolean; // drawn but ignored by QC and the camera solver (rugs, posters, mugs, skies)
  dress: boolean; // set dressing rather than an anchor's furniture
  scale: number;
}

export interface SetGeometry {
  w: number;
  d: number;
  h: number;
  /** every box, for drawing */
  boxes: Box[];
  /** the boxes QC and the camera solver treat as geometry (everything but decor) */
  obstacles: Box[];
}

export function setGeometry(set: SetDef): SetGeometry {
  const boxes: Box[] = [];
  for (const a of Object.values(set.anchors)) {
    const f = a.furniture ? furnitureSpec(a.furniture) : null;
    if (!a.furniture || !f) continue;
    const yaw = a.face === null ? 0 : (a.face * Math.PI) / 180;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const off = f.placement === "front" ? f.d / 2 + 0.3 : f.placement === "at" || f.placement === "flat" || f.placement === "onSurface" ? 0 : -0.35;
    // a prop in front of a mark faces the person standing on it; everything else faces the way the mark faces
    boxes.push({
      id: a.id, kind: a.furniture, prop: f.prop,
      cx: a.x + fx * off, cy: a.furniture === "window" ? 1.5 : f.y0 + f.h / 2, cz: a.z + fz * off,
      w: f.w, h: f.h, d: f.d, yaw, ry: f.placement === "front" ? yaw + Math.PI : yaw, y: 0,
      sittable: f.sittable, solid: f.solid, decor: f.decor, dress: false, scale: 1,
    });
  }
  const used = new Set(boxes.map((b) => b.id));
  for (const d of set.dress) {
    const f = furnitureSpec(d.kind);
    if (!f) continue;
    const k = d.scale;
    let id = d.id, n = 2;
    while (used.has(id)) id = `${d.id}.${n++}`;
    used.add(id);
    const yaw = (d.face * Math.PI) / 180;
    boxes.push({
      id, kind: d.kind, prop: f.prop,
      cx: d.x, cy: d.y + (f.y0 + f.h / 2) * k, cz: d.z,
      w: f.w * k, h: f.h * k, d: f.d * k, yaw, ry: yaw, y: d.y,
      sittable: f.sittable, solid: f.solid, decor: f.decor, dress: true, scale: k,
    });
  }
  // an open set has no walls: QC and the camera solver get generous bounds around the playable rectangle
  const open = !!set.open;
  return { w: open ? set.w + OPEN_PAD * 2 : set.w, d: open ? set.d + OPEN_PAD * 2 : set.d, h: open ? OPEN_HEIGHT : WALL_HEIGHT, boxes, obstacles: boxes.filter((b) => !b.decor) };
}

/** Point in box local frame. */
function local(b: Box, x: number, y: number, z: number): [number, number, number] {
  const dx = x - b.cx, dz = z - b.cz;
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  // inverse of rotation about y by yaw
  return [dx * c - dz * s, y - b.cy, dx * s + dz * c];
}

/** How far a vertical cylinder (a person) penetrates a box footprint, in metres (<= 0: clear). */
export function cylinderInto(b: Box, x: number, z: number, r: number, top: number): number {
  if (top < b.cy - b.h / 2 || 0 > b.cy + b.h / 2) return 0;
  const [lx, , lz] = local(b, x, 0, z);
  const qx = Math.max(Math.abs(lx) - b.w / 2, 0), qz = Math.max(Math.abs(lz) - b.d / 2, 0);
  const outside = Math.hypot(qx, qz);
  const inside = Math.min(Math.max(Math.abs(lx) - b.w / 2, Math.abs(lz) - b.d / 2), 0);
  return r - (outside + inside);
}

export function pointInBox(b: Box, p: number[], margin = 0): boolean {
  const [x, y, z] = local(b, p[0], p[1], p[2]);
  return Math.abs(x) < b.w / 2 - margin && Math.abs(y) < b.h / 2 - margin && Math.abs(z) < b.d / 2 - margin;
}

/** Distance along a unit ray to the first hit with the box, or Infinity. */
export function rayBox(b: Box, o: number[], dir: number[]): number {
  const [ox, oy, oz] = local(b, o[0], o[1], o[2]);
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  const dx = dir[0] * c - dir[2] * s, dy = dir[1], dz = dir[0] * s + dir[2] * c;
  let t0 = -Infinity, t1 = Infinity;
  for (const [p, d, h] of [[ox, dx, b.w / 2], [oy, dy, b.h / 2], [oz, dz, b.d / 2]]) {
    if (Math.abs(d) < 1e-9) { if (Math.abs(p) > h) return Infinity; continue; }
    let a = (-h - p) / d, bb = (h - p) / d;
    if (a > bb) [a, bb] = [bb, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, bb);
    if (t0 > t1) return Infinity;
  }
  return t1 < 0 ? Infinity : Math.max(0, t0);
}

/** Distance along a unit ray from inside the room to the walls/ceiling/floor (with a margin). */
export function rayRoom(g: SetGeometry, o: number[], dir: number[], margin = 0.12): number {
  const lim = [[-g.w / 2 + margin, g.w / 2 - margin], [margin, g.h - margin], [-g.d / 2 + margin, g.d / 2 - margin]];
  let t = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-9) continue;
    const edge = dir[i] > 0 ? lim[i][1] : lim[i][0];
    const k = (edge - o[i]) / dir[i];
    if (k >= 0) t = Math.min(t, k);
  }
  return t;
}

export function insideRoom(g: SetGeometry, p: number[], margin = 0.05): boolean {
  return Math.abs(p[0]) < g.w / 2 - margin && p[1] > margin && p[1] < g.h - margin && Math.abs(p[2]) < g.d / 2 - margin;
}

/** Ray vs sphere: distance to first hit or Infinity. */
export function raySphere(c: number[], r: number, o: number[], dir: number[]): number {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * dir[0] + oy * dir[1] + oz * dir[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : cc < 0 ? 0 : Infinity;
}
