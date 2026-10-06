// The crew. Haiku proposes wide, Sonnet refines, Opus chooses and writes.

import type { RoleId } from "../scene/registry.ts";

export type Tier = "haiku" | "sonnet" | "opus";
export type Effort = "low" | "medium" | "high";

export interface RoleDef {
  id: RoleId;
  title: string;
  /** the tier this role's own work runs at when it is not escalated */
  tier: Tier;
  /** tiers a proposal climbs through when candidates fail validation or the guard */
  ladder: Tier[];
  effort: Effort;
  owns: string;
  brief: string;
}

export const ROLES: Record<RoleId, RoleDef> = {
  director: {
    id: "director", title: "Director", tier: "opus", ladder: ["opus"], effort: "medium",
    owns: "everything (only used to break ties and to talk to the human director)",
    brief: "You run the crew and talk to the human director. Results first, short. Recommend one take and say why in one sentence. Push back with a reason if the note will hurt the cut. Offer exactly one idea they didn't ask for.",
  },
  writer: {
    id: "writer", title: "Writers' room", tier: "opus", ladder: ["opus"], effort: "high",
    owns: "dialogue lines (say / whisper / shout)",
    brief: "You own dialogue. Keep every character's voice consistent with earlier lines. Shorter is almost always better: cut words before adding them.",
  },
  blocking: {
    id: "blocking", title: "Blocking", tier: "sonnet", ladder: ["haiku", "sonnet", "opus"], effort: "medium",
    owns: "body positions and movement: enter exit walk run sit stand kneel lean turn open close take give put wait, and @anchor pins",
    brief: "You own where bodies are. Solve collisions and staging with the smallest move. Use real paths through the set; never route a character through another one.",
  },
  dp: {
    id: "dp", title: "Director of Photography", tier: "sonnet", ladder: ["haiku", "sonnet", "opus"], effort: "medium",
    owns: "shot headers (size, subjects, move, lens, angle, side), light lines, and adding coverage shots",
    brief: "You own the camera and the light. Respect the Style Bible lens and move rules unless the note demands otherwise, and say when you break them. Keep the 180-degree line.",
  },
  animator: {
    id: "animator", title: "Animator", tier: "sonnet", ladder: ["haiku", "sonnet", "opus"], effort: "medium",
    owns: "faces, eyelines and gestures: look glare smile laugh frown shock sad angry scared guilty think nod shake shrug sigh cry wave point blink neutral",
    brief: "You own performance accents: holds, reactions, eyelines. Pose-to-pose and specific. A held look usually beats a bigger expression.",
  },
  editor: {
    id: "editor", title: "Editor", tier: "sonnet", ladder: ["haiku", "sonnet", "opus"], effort: "medium",
    owns: "trim and hold lines, and dropping whole shots",
    brief: "You own the cut and its rhythm. Default to subtraction: trim before you add, drop a shot before you add one, hold on a reaction rather than cutting away.",
  },
  sound: {
    id: "sound", title: "Sound", tier: "sonnet", ladder: ["haiku", "sonnet", "opus"], effort: "medium",
    owns: "sfx, music, ambience and silence lines",
    brief: "You own everything heard that isn't dialogue. Silence is a sound choice. One clear sound idea per moment.",
  },
};

export const CRAFT_ROLES: RoleId[] = ["writer", "blocking", "dp", "animator", "editor", "sound"];

export const ESCALATE: Record<Tier, Tier | null> = { haiku: "sonnet", sonnet: "opus", opus: null };
