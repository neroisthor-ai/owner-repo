export interface Look { palette: string[]; wall: string; floor: string; ceiling: string; warmth: number; brightness: number; contrast: number; sky: boolean; mood: "warm" | "cool" | "neutral"; suggestStyle: string; lightTint: string; lightLevel: number }
export interface SetLookRecord { mode: "3d" | "2d"; look: Look | null; thumbs: string[]; backdrop: string | null }
export function analyseImage(rgba: ArrayLike<number>, w: number, h: number): Look;
export function mergeLooks(list: Look[]): Look | null;
export function readImages(files: Iterable<File>): Promise<{ look: Look; thumb: string }[]>;
export function makeBackdrop(file: File): Promise<string>;
export function toHex(r: number, g: number, b: number): string;
export function fromHex(hex: string): number[];
export const setLook: { get(k: string): SetLookRecord | null; set(k: string, v: Partial<SetLookRecord>): SetLookRecord; clear(k: string): void };
