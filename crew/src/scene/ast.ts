// SCENE abstract syntax. One node per source line, so every line has an address.

export interface ShotHeader {
  kind: "shot";
  id: string;
  type: string; // CU, MS, OTS, ...
  subjects: string[];
  move: string | null;
  speed: string | null;
  lens: number | null;
  angle: string | null;
  side: string | null;
}

export interface ActionLine {
  kind: "action";
  with: boolean;
  actor: string;
  at: string | null;
  verb: string;
  target: string | null;
  target2: string | null;
  number: number | null;
  dur: number | null;
}

export interface DialogueLine {
  kind: "dialogue";
  with: boolean;
  actor: string;
  verb: string; // say | whisper | shout
  text: string;
  to: string | null;
  dur: number | null;
}

export interface SoundLine {
  kind: "sound";
  with: boolean;
  verb: string; // sfx | music | ambience | silence
  name: string | null;
  dur: number | null;
}

export interface LightLine {
  kind: "light";
  mood: string;
}

export interface EditLine {
  kind: "edit";
  verb: "trim" | "hold";
  a: number;
  b: number | null;
}

export interface CommentLine {
  kind: "comment";
  text: string;
}

export interface SceneLine {
  kind: "scene";
  n: number;
  set: string;
  time: string;
  act: number | null;
}

export interface EpisodeLine {
  kind: "episode";
  n: number;
  title: string;
}

export type BodyNode = ActionLine | DialogueLine | SoundLine | LightLine | EditLine | CommentLine;
export type Node = ShotHeader | SceneLine | EpisodeLine | BodyNode;
export type LineKind = Node["kind"];

export interface DocLine {
  uid: number;
  text: string; // raw source text, preserved byte-for-byte unless the line is edited
  node: Node | null; // null for blank lines
  error?: string;
}

export interface Doc {
  lines: DocLine[];
}

// ---------------------------------------------------------------- show bible

export interface Style {
  lens: number;
  sensor: [number, number];
  fps: number;
  twos: boolean;
  asl: number;
  move: string;
  speed: string;
  pace: number;
  side: "left" | "right";
  palette: string;
  pad: number;
  acts: Record<number, { palette?: string }>;
}

export interface CastMember {
  id: string;
  name: string;
  height: number;
  color: string;
  voice: string;
  pace: number | null;
  /** character model: male | female (assets/characters), or null for the procedural rig */
  model: string | null;
  /** voice design for TTS: Kokoro blend ("bf_emma:0.62+af_heart:0.38") or "preset:<name>" */
  tts: string | null;
  lang: string | null;
  /** TTS base speed multiplier */
  ttsSpeed: number | null;
}

export interface Anchor {
  id: string;
  x: number;
  z: number;
  face: number | null; // degrees, 0 = facing +z (toward default camera)
  furniture: string | null;
}

export interface Prop {
  id: string;
  x: number;
  z: number;
  y: number;
  on: string | null;
  /** library prop that draws it (defaults to the id when that is a library prop) */
  kind: string | null;
}

/** Set dressing: a library prop placed in the set with no stand mark. `face` is the direction its front points (0 = +z). */
export interface Dress {
  id: string;
  kind: string;
  x: number;
  z: number;
  /** elevation of the model's origin (0 on the floor, the surface height when dressed `on` furniture) */
  y: number;
  face: number;
  scale: number;
  on: string | null;
}

export interface SetDef {
  id: string;
  w: number;
  d: number;
  entrance: string;
  anchors: Record<string, Anchor>;
  props: Record<string, Prop>;
  dress: Dress[];
  /** open to the sky (street, park): no walls or ceiling, and the camera may stand outside the rectangle */
  open?: boolean;
  /** library set this was included from, if any */
  from?: string;
}

export interface Show {
  title: string;
  style: Style;
  cast: Record<string, CastMember>;
  sets: Record<string, SetDef>;
  errors: { line: number; message: string }[];
}

// ---------------------------------------------------------------- derived structure

export interface ShotBlock {
  id: string;
  headerIndex: number; // index into doc.lines
  header: ShotHeader;
  body: { index: number; addr: string; node: BodyNode }[];
  scene: SceneLine;
  sceneIndex: number; // 0-based ordinal of the scene
}

export interface Structure {
  episode: EpisodeLine | null;
  scenes: { index: number; node: SceneLine; shots: ShotBlock[] }[];
  shots: ShotBlock[];
  /** address -> doc line index */
  addr: Map<string, number>;
  /** doc line index -> address */
  addrOf: Map<number, string>;
  /** doc line index -> shot id */
  shotOf: Map<number, string>;
}
