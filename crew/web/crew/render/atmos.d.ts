export interface Env { elev: number; sun: number[]; hor0: number[]; hor1: number[]; zen: number[]; haze: number; cover: number; sunBoost: number }
export const ENV: Record<string, Env>;
export function envFor(shot: { light?: string } | undefined): Env;
export function sunDir(T: { Vector3: new (x: number, y: number, z: number) => { normalize(): any } }, keyPos: { x: number; z: number }, env: Env): any;
