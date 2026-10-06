export type Placement = "front" | "at" | "behind" | "wall" | "ceiling" | "onSurface" | "flat";
export interface PropMeta {
  id: string;
  title: string;
  category: string;
  placement: Placement;
  source: "The Bob" | "Low Pass" | "new";
  module: "interior" | "vehicles" | "exterior" | "structures" | "generated";
  /** measured bounding box [w, h, d] in metres */
  size: [number, number, number];
  /** lowest point of the model (hung props start above the floor) */
  y0: number;
  /** x, z of the bounding-box centre relative to the origin the builder uses */
  center: [number, number];
  sittable?: boolean;
  sitHeight?: number;
  /** height of the usable top, for things that carry other props */
  surface?: number;
  decor?: boolean;
  animated?: boolean;
  openable?: boolean;
  light?: boolean | string;
}
export const BASE_META: Record<string, PropMeta>;
export const PROP_META: Record<string, PropMeta>;
export const PROP_IDS: string[];
