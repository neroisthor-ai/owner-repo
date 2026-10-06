import type { Group, Object3D } from "three";
import type { PropMeta } from "./meta.js";
export type Prop = PropMeta & { build(opts?: Record<string, unknown>): Group };
export const PROPS: Record<string, Prop>;
export const PROP_META: Record<string, PropMeta>;
export const PROP_IDS: string[];
export function buildProp(id: string, opts?: Record<string, unknown>): Group;
/** Build a baked set box (baked.sets[].boxes[]) as a placed, scaled prop model; null if the box has no prop. */
export function buildBox(box: { prop: string | null; cx: number; cz: number; y: number; ry: number; w: number; d: number; dress: boolean; scale: number; [k: string]: unknown }, THREE: typeof import("three")): Object3D | null;
