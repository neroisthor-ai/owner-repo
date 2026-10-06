export function halton(i: number, b: number): number;
export function cocFactor(focalMm: number, fstop: number, focusM: number, rtH: number, sensorH: number): number;
export function infoAt(baked: any, t: number): { shot: any; t: number; o: number; fps: number };
export const settings: Record<string, any>;
export function resolveGrade(shot: { id: string; light?: string; palette?: string }, closed?: boolean): import('./grades.js').Grade;
