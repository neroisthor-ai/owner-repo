// The SCENE registry: the closed vocabulary of the film language.
// Every word an agent (or a human) can write lives here, together with the
// real-world defaults that turn words into timing, distances and lenses.
// Unknown words are rejected by the parser before anything renders.

export type RoleId = "director" | "writer" | "blocking" | "dp" | "animator" | "editor" | "sound";

// ---------------------------------------------------------------- camera

/** Vertical frame height (metres at the subject) for each shot size. */
export const SHOT_SIZES: Record<string, { frame: number; label: string }> = {
  ECU: { frame: 0.18, label: "extreme close-up" },
  CU: { frame: 0.38, label: "close-up" },
  MCU: { frame: 0.62, label: "medium close-up" },
  MS: { frame: 1.0, label: "medium shot" },
  MLS: { frame: 1.45, label: "medium long shot" },
  FS: { frame: 2.3, label: "full shot" },
  WS: { frame: 4.5, label: "wide shot" },
  EWS: { frame: 11, label: "extreme wide shot" },
};

/** Shot types that are defined by relationships rather than a size. */
export const SHOT_TYPES: Record<string, { label: string; subjects: [number, number] }> = {
  OTS: { label: "over the shoulder (a>b: over a's shoulder onto b)", subjects: [2, 2] },
  POV: { label: "point of view (a>b: a's eyes looking at b)", subjects: [2, 2] },
  TWO: { label: "two shot, both subjects framed", subjects: [2, 2] },
  INSERT: { label: "insert on a prop", subjects: [1, 1] },
};

export const ALL_SHOT_KINDS = [...Object.keys(SHOT_SIZES), ...Object.keys(SHOT_TYPES)];

/** Ordered tight -> wide, used for "closer"/"wider" style edits. */
export const SIZE_ORDER = ["ECU", "CU", "MCU", "MS", "MLS", "FS", "WS", "EWS"];

export const CAMERA_MOVES: Record<string, string> = {
  static: "locked off",
  push: "dolly in toward the subject",
  pull: "dolly out from the subject",
  pan: "camera fixed, aim follows the subject",
  track: "camera travels alongside the subject",
  orbit: "camera arcs around the subject",
  crane: "camera rises",
  tilt: "camera tilts up the subject",
  zoom: "focal length increases (flattens space, unlike push)",
  handheld: "organic operator shake",
};

/** Move intensity: fraction of distance / angle covered over the shot. */
export const MOVE_SPEEDS: Record<string, number> = { slow: 0.18, med: 0.35, fast: 0.6 };

export const ANGLES = ["eye", "low", "high"];
export const SIDES = ["left", "right"];

/** Common prime lenses (mm). Any number is legal; these are what agents are told to prefer. */
export const LENSES = [18, 24, 28, 35, 50, 65, 85, 100, 135];

export const LIGHT_MOODS: Record<string, string> = {
  day: "neutral daylight",
  night: "low blue ambient, warm practicals",
  warm: "golden, soft",
  cool: "cold, desaturated",
  dim: "underexposed, moody",
  bright: "high key",
  practical: "lit by an in-scene source (fridge, lamp, screen)",
  moon: "hard blue key from a window",
};

// ---------------------------------------------------------------- performance & blocking

export type TargetKind = "none" | "anchor" | "char" | "prop" | "place" | "any";

export interface VerbDef {
  role: RoleId;
  target: TargetKind;
  /** default beat length in seconds when not moving and not overridden by ~N */
  dur: number;
  /** optional second target (give <prop> <char>, put <prop> <anchor>) */
  target2?: TargetKind;
  /** expression verbs persist as the face state until changed */
  expression?: boolean;
  help: string;
}

// Blocking: where bodies are. Owned by the Blocking agent.
export const BLOCKING_VERBS: Record<string, VerbDef> = {
  enter: { role: "blocking", target: "place", dur: 0.6, help: "appear at @anchor (or the set entrance), then walk to the target if given" },
  exit: { role: "blocking", target: "place", dur: 0.6, help: "walk to the target (default: entrance) and leave" },
  walk: { role: "blocking", target: "place", dur: 0, help: "walk to an anchor or character; optional number = speed m/s" },
  run: { role: "blocking", target: "place", dur: 0, help: "run to an anchor or character; optional number = speed m/s" },
  sit: { role: "blocking", target: "place", dur: 1.2, help: "sit (at target if given)" },
  stand: { role: "blocking", target: "none", dur: 1.0, help: "stand up" },
  kneel: { role: "blocking", target: "none", dur: 1.0, help: "kneel" },
  lean: { role: "blocking", target: "place", dur: 0.8, help: "lean (on target if given)" },
  turn: { role: "blocking", target: "any", dur: 0.6, help: "turn the body to face a target" },
  open: { role: "blocking", target: "prop", dur: 1.0, help: "open a prop" },
  close: { role: "blocking", target: "prop", dur: 0.8, help: "close a prop" },
  take: { role: "blocking", target: "prop", dur: 0.9, help: "pick up a prop" },
  give: { role: "blocking", target: "prop", target2: "char", dur: 1.1, help: "give <prop> <char>" },
  put: { role: "blocking", target: "prop", target2: "anchor", dur: 0.9, help: "put <prop> <anchor> (default: where you stand)" },
  wait: { role: "blocking", target: "none", dur: 1.0, help: "hold position (use ~N)" },
};

// Performance: faces and gestures. Owned by the Animator agent.
export const PERFORMANCE_VERBS: Record<string, VerbDef> = {
  look: { role: "animator", target: "any", dur: 0.6, help: "eyeline to a target (persists)" },
  glare: { role: "animator", target: "any", dur: 1.0, expression: true, help: "angry look at a target" },
  neutral: { role: "animator", target: "none", dur: 0.5, expression: true, help: "relax the face" },
  smile: { role: "animator", target: "none", dur: 1.0, expression: true, help: "smile" },
  laugh: { role: "animator", target: "none", dur: 1.6, expression: true, help: "laugh" },
  frown: { role: "animator", target: "none", dur: 1.0, expression: true, help: "frown" },
  shock: { role: "animator", target: "none", dur: 1.2, expression: true, help: "startle / shock" },
  sad: { role: "animator", target: "none", dur: 1.2, expression: true, help: "sadness" },
  angry: { role: "animator", target: "none", dur: 1.0, expression: true, help: "anger" },
  scared: { role: "animator", target: "none", dur: 1.0, expression: true, help: "fear" },
  guilty: { role: "animator", target: "none", dur: 1.2, expression: true, help: "caught out / guilt" },
  think: { role: "animator", target: "none", dur: 1.5, expression: true, help: "thinking" },
  nod: { role: "animator", target: "none", dur: 0.6, help: "nod" },
  shake: { role: "animator", target: "none", dur: 0.7, help: "head shake" },
  shrug: { role: "animator", target: "none", dur: 0.8, help: "shrug" },
  sigh: { role: "animator", target: "none", dur: 1.2, help: "sigh" },
  cry: { role: "animator", target: "none", dur: 2.5, expression: true, help: "cry" },
  wave: { role: "animator", target: "any", dur: 1.0, help: "wave (at target)" },
  point: { role: "animator", target: "any", dur: 0.8, help: "point at target" },
  blink: { role: "animator", target: "none", dur: 0.25, help: "slow blink" },
};

export const ACTION_VERBS: Record<string, VerbDef> = { ...BLOCKING_VERBS, ...PERFORMANCE_VERBS };

export const EXPRESSIONS = ["neutral", ...Object.entries(PERFORMANCE_VERBS).filter(([, v]) => v.expression).map(([k]) => (k === "glare" ? "angry" : k)).filter((k) => k !== "neutral")];

// ---------------------------------------------------------------- dialogue

/** Speaking pace multipliers on the character's words-per-minute. */
export const SPEECH_VERBS: Record<string, { pace: number; help: string }> = {
  say: { pace: 1.0, help: "normal delivery" },
  whisper: { pace: 0.85, help: "quiet, slower" },
  shout: { pace: 1.1, help: "loud, faster" },
};

export const DEFAULT_WPM = 160;
/** extra seconds for each internal sentence break / dash / ellipsis */
export const PHRASE_PAUSE = 0.3;
/** breath after a line before the next beat */
export const LINE_TAIL = 0.25;

// ---------------------------------------------------------------- sound

export const SFX: Record<string, number> = {
  door: 0.6, "door.creak": 1.2, knock: 0.8, footsteps: 1.5, "fridge.hum": 2.0, "fridge.open": 0.5,
  glass: 0.5, mug: 0.4, plate: 0.5, fork: 0.3, phone: 1.5, clock: 1.0, rain: 3.0, thunder: 2.0,
  wind: 3.0, crash: 1.0, chair: 0.6, kettle: 2.0, sting: 0.8, whoosh: 0.6, "light.switch": 0.2,
};

export const MUSIC_CUES: Record<string, string> = {
  tense: "low minor drone", warm: "soft major pad", sad: "slow minor piano", upbeat: "light pizzicato",
  mystery: "sparse bells", comic: "bouncy bassoon", stop: "end the current cue",
};

export const AMBIENCE: Record<string, string> = {
  room: "quiet room tone", night: "night crickets, distant traffic", kitchen: "fridge hum, clock",
  rain: "rain on windows", street: "traffic and people", stop: "end the ambience",
};

export const SOUND_VERBS: Record<string, string> = {
  sfx: "one-shot effect, takes its natural length unless `with`",
  music: "start/stop a music cue (plays until `music stop` or scene end)",
  ambience: "start/stop a background bed",
  silence: "everything drops out for ~N seconds (it takes beat time)",
};

// ---------------------------------------------------------------- edit

export const EDIT_VERBS: Record<string, string> = {
  trim: "trim <head> <tail>: seconds removed from the start and end of the shot in the cut",
  hold: "hold <seconds>: freeze-extend the end of the shot in the cut",
};

// ---------------------------------------------------------------- physics & people

export const PHYSICS = {
  walkSpeed: 1.35, // m/s, average adult
  runSpeed: 3.4,
  maxWalkSpeed: 2.3, // above this a walk cycle visibly foot-slides
  minWalkSpeed: 0.35, // below this it reads as floating
  maxRunSpeed: 7.0,
  turnRate: 300, // deg/s
  personRadius: 0.24, // m, used by the intersection check
  conversationDistance: 0.9, // where `walk <char>` stops
  eyeRatio: 0.935, // eye height / body height
  sitEyeRatio: 0.66,
  kneelEyeRatio: 0.7,
};

export const SENSORS: Record<string, [number, number]> = {
  "36x24": [36, 24], // full frame
  s35: [24.89, 18.66], // Super 35
  "4/3": [17.3, 13],
};

export const PALETTES: Record<string, { bg: string; floor: string; wall: string; key: string; fill: string; prop: string }> = {
  warm: { bg: "#2b1d16", floor: "#7a5a43", wall: "#c9a27e", key: "#ffd9a8", fill: "#6a4a7a", prop: "#d8c3a5" },
  cold: { bg: "#0f1724", floor: "#3c4a5c", wall: "#7f93a8", key: "#cfe3ff", fill: "#24324a", prop: "#a9b8c8" },
  night: { bg: "#070b14", floor: "#1d2433", wall: "#33405a", key: "#8fb3ff", fill: "#1a1630", prop: "#5a6680" },
  noir: { bg: "#0a0a0a", floor: "#2a2a2a", wall: "#5a5a5a", key: "#f2f2f2", fill: "#151515", prop: "#8a8a8a" },
  pastel: { bg: "#f3e9f2", floor: "#e6d3c4", wall: "#f7efe4", key: "#ffffff", fill: "#c9d8f0", prop: "#f2c6c2" },
  day: { bg: "#bcd3e6", floor: "#b49a7e", wall: "#ece3d6", key: "#fff6e6", fill: "#9fb4cf", prop: "#d9cbb6" },
};

export const COLORS: Record<string, string> = {
  teal: "#2bb5a8", coral: "#ff7a6b", gold: "#f2b84b", violet: "#8f6bff", sky: "#5aa9ff",
  lime: "#9bd85a", rose: "#ff6fa8", slate: "#7d8ca3", sand: "#d8b98a", ink: "#3a4256",
};

/** Furniture footprint guesses for grey-box sets, keyed by words in the anchor name. */
export const FURNITURE: Record<string, { w: number; d: number; h: number }> = {
  counter: { w: 1.6, d: 0.6, h: 0.92 }, fridge: { w: 0.75, d: 0.7, h: 1.85 }, table: { w: 1.4, d: 0.9, h: 0.75 },
  sofa: { w: 2.0, d: 0.9, h: 0.85 }, bed: { w: 1.6, d: 2.0, h: 0.55 }, desk: { w: 1.4, d: 0.7, h: 0.75 },
  window: { w: 1.2, d: 0.1, h: 1.2 }, door: { w: 0.9, d: 0.08, h: 2.05 }, chair: { w: 0.5, d: 0.5, h: 0.9 },
  sink: { w: 0.8, d: 0.6, h: 0.92 }, stove: { w: 0.7, d: 0.65, h: 0.92 }, shelf: { w: 1.0, d: 0.35, h: 1.8 },
  stairs: { w: 1.0, d: 2.0, h: 1.4 }, tv: { w: 1.2, d: 0.3, h: 1.1 },
};

/** Words that are structural keywords and can never be used as names. */
export const RESERVED = new Set([
  "show", "style", "cast", "set", "include", "dress", "anchor", "prop", "episode", "scene", "with", "light", "trim", "hold",
  "sfx", "music", "ambience", "silence", "lens", "angle", "side", "to", "at", "on", "face", "act",
  ...Object.keys(ACTION_VERBS), ...Object.keys(SPEECH_VERBS), ...ALL_SHOT_KINDS.map((s) => s.toLowerCase()),
]);
