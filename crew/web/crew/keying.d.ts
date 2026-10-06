export type KeyOptions = { on?: boolean; color?: string; tol?: number; soft?: number; spill?: number };
export const KEY_DEFAULTS: Required<KeyOptions>;
export function hexToRgb(hex: string): [number, number, number];
export function chroma(r: number, g: number, b: number): [number, number];
export function keyPixels(data: Uint8ClampedArray, key?: KeyOptions): Uint8ClampedArray;
export function keptShare(data: Uint8ClampedArray): number;
export function guessScreen(data: Uint8ClampedArray): string | null;
