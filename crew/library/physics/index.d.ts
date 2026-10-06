export type V3 = [number, number, number];
export type Quat = [number, number, number, number];
export const clamp: (x: number, a: number, b: number) => number;
export const lerp: (a: number, b: number, t: number) => number;
export const sstep: (a: number, b: number, x: number) => number;
export function rng(seed: number): () => number;
export const v3: { add(a: V3, b: V3): V3; sub(a: V3, b: V3): V3; mul(a: V3, k: number): V3; dot(a: V3, b: V3): number; cross(a: V3, b: V3): V3; len(a: V3): number; norm(a: V3): V3; lerp(a: V3, b: V3, t: number): V3 };
export function quatFromBasis(x: V3, y: V3, z: V3): Quat;

export function spring(x: number, v: number, target: number, w: number, z: number, dt: number, extra?: number): [number, number];
export interface Sim { dt: number; t0: number; n: number; [channel: string]: any }
export function simulate(o: { t0: number; t1: number; dt?: number; channels: string[]; step: (i: number, t: number, state: any, out: Sim) => void; init?: object }): Sim;
export function sample(sim: Sim, channel: string, t: number): number;

export const WDIR: [number, number][];
export function waves(px: number, pz: number, t: number, it?: number): number;
export function oceanHeight(px: number, pz: number, t: number, o?: { iterations?: number; scale?: number; whirl?: { center: [number, number]; amount: number; spin: number } | null }): number;

export function hullStations(o?: { halfLength?: number; halfBeam?: number; step?: number; reach?: number }): [number, number][];
export const DEFAULTS: Record<string, any>;
export interface HullState { pos: V3; quat: Quat; R: [V3, V3, V3]; yaw: number; pitch: number; roll: number; heave: number; surge: number }
export function simulateHull(o: {
  path: (t: number) => [number, number]; sea: { height(x: number, z: number, t: number): number; step?(t: number, dt: number): void };
  t0: number; t1: number; dt?: number; stations?: [number, number][]; heel?: ((t: number) => number) | null; thrust?: ((t: number, dt: number) => number) | null; params?: Record<string, any>;
}): { sim: Sim; at(t: number): HullState };
export function toWorld(ship: HullState, local: V3): V3;

export function track(keys: number[][]): (t: number) => V3;
export function orientFrom(fn: (t: number) => V3, t: number, o?: { gain?: number; roll?: number; maxBank?: number }): { f: V3; u: V3; x: V3; quat: Quat; bank: number };

export class Spray {
  constructor(o?: { count?: number; gravity?: number; drag?: number; waterY?: number; rate?: number; seed?: number });
  N: number; pos: Float32Array; vel: Float32Array; life: Float32Array; max: Float32Array; size: Float32Array; alpha: Float32Array; waterY: number;
  reset(): void; step(dt: number, e?: { x: number; z: number; vx: number; vz: number; strength: number } | null): void; readonly alive: number;
}
export class Trail {
  constructor(o?: { maxPts?: number; width?: number; life?: number });
  pts: { p: V3; t: number; k: number }[]; maxPts: number;
  reset(): void; push(p: V3, t: number, k?: number): void; build(now: number, cam: V3): { position: Float32Array; alpha: Float32Array; count: number };
}
export function replay(o: { reset: () => void; step: (t: number, dt: number) => void; t: number; window?: number; dt?: number }): void;
