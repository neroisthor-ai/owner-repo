// How much hand-holding a model gets is decided per skill: the harder the skill and the weaker the model at it,
// the tighter the grip. A strong model on an easy skill runs free (Claude's path); a model near its limit gets
// examples, repairs and votes; a model past its limit gets menus and code-first answers.
//
// The numbers are starting estimates (0 to 1). They are meant to be replaced by measured pass rates from
// `npm run eval` and the call log, and any skill can be pinned with CREW_GRIP_<SKILL>=free|guided|strict.

export type Skill =
  | "read"      // find the shots and roles a note is about
  | "rank"      // order valid takes against a note
  | "plan"      // turn a note into a concrete plan
  | "patch"     // write a SCENE patch that passes the checks
  | "review"    // judge takes against a plan
  | "script"    // write a whole episode from a script
  | "prop3d"    // author a procedural 3D prop or set piece as code
  | "motion"    // author a new gesture or performance beat for the rig
  | "voice"     // direct a voice performance
  | "vision";   // read reference pictures (sets, framing)

export type Grip = "free" | "guided" | "strict";

/** How hard each skill is for any model, before the model's own ability is counted. */
export const DIFFICULTY: Record<Skill, number> = {
  read: 0.25, rank: 0.3, plan: 0.5, patch: 0.55, review: 0.5, script: 0.75, prop3d: 0.8, motion: 0.75, voice: 0.4, vision: 0.5,
};

/** Estimated ability per model family and skill. Unknown models get the `default` row. */
export const CAPABILITY: { match: RegExp; skills: Record<Skill, number> }[] = [
  { match: /claude-(opus|fable)/, skills: { read: 0.95, rank: 0.95, plan: 0.95, patch: 0.92, review: 0.95, script: 0.92, prop3d: 0.88, motion: 0.85, voice: 0.85, vision: 0.9 } },
  { match: /claude-sonnet/, skills: { read: 0.92, rank: 0.9, plan: 0.88, patch: 0.88, review: 0.88, script: 0.85, prop3d: 0.85, motion: 0.8, voice: 0.8, vision: 0.85 } },
  { match: /gemini-[\d.]+-pro/, skills: { read: 0.9, rank: 0.9, plan: 0.88, patch: 0.82, review: 0.88, script: 0.85, prop3d: 0.85, motion: 0.78, voice: 0.85, vision: 0.92 } },
  { match: /gemini-[\d.]+-flash-lite/, skills: { read: 0.65, rank: 0.6, plan: 0.5, patch: 0.5, review: 0.5, script: 0.45, prop3d: 0.45, motion: 0.4, voice: 0.6, vision: 0.65 } },
  { match: /gemini-[\d.]+-flash/, skills: { read: 0.85, rank: 0.82, plan: 0.75, patch: 0.75, review: 0.75, script: 0.72, prop3d: 0.75, motion: 0.68, voice: 0.8, vision: 0.85 } },
  { match: /claude-haiku/, skills: { read: 0.8, rank: 0.75, plan: 0.65, patch: 0.65, review: 0.65, script: 0.6, prop3d: 0.6, motion: 0.55, voice: 0.6, vision: 0.7 } },
  { match: /./, skills: { read: 0.6, rank: 0.6, plan: 0.5, patch: 0.5, review: 0.5, script: 0.45, prop3d: 0.45, motion: 0.4, voice: 0.5, vision: 0.5 } },
];

export function ability(model: string, skill: Skill): number {
  return (CAPABILITY.find((c) => c.match.test(model)) ?? CAPABILITY[CAPABILITY.length - 1]).skills[skill];
}

/** Margin above the skill's difficulty needed to run free, and below which the grip goes strict. */
export const MARGINS = { free: 0.15, strict: -0.05 };

export function gripFor(model: string, skill: Skill): Grip {
  const pinned = process.env[`CREW_GRIP_${skill.toUpperCase()}`];
  if (pinned === "free" || pinned === "guided" || pinned === "strict") return pinned;
  const margin = ability(model, skill) - DIFFICULTY[skill];
  return margin >= MARGINS.free ? "free" : margin >= MARGINS.strict ? "guided" : "strict";
}

export interface GripSettings {
  /** independent answers to take a majority over (choice skills only) */
  votes: number;
  /** worked examples in the prompt */
  examples: number;
  /** repair rounds with explained failures before escalating */
  repairs: number;
  /** code-made candidates compete with the model's own (true) or only stand in when the model produced nothing (false) */
  codeFirst: boolean;
  /** what the model sees: just the target shots, or the whole episode */
  context: "targets" | "episode";
}

export const GRIP: Record<Grip, GripSettings> = {
  free: { votes: 1, examples: 0, repairs: 1, codeFirst: false, context: "episode" },
  guided: { votes: 1, examples: 2, repairs: 2, codeFirst: false, context: "episode" },
  strict: { votes: 3, examples: 3, repairs: 2, codeFirst: true, context: "targets" },
};

export const settingsFor = (model: string, skill: Skill): GripSettings & { grip: Grip } => {
  const grip = gripFor(model, skill);
  return { grip, ...GRIP[grip] };
};
