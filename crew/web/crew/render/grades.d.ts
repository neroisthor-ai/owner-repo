export interface Grade { exp: number; bloom: number; hal: number; th: number; lift: number[]; gain: number[]; sh: number[]; hi: number[]; split: number; sat: number; con: number; ca: number; vig: number; grain: number; cam: number; key: number; tau: number; emin: number; emax: number; streak?: number; dirt?: number }
export const GRADES: Record<string, Grade>;
export function gradeFor(shot: { light?: string; palette?: string } | undefined, overrides?: Partial<Grade>): Grade;
