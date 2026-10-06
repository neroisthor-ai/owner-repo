// Prompt text. Everything stable lives in `stableSystem()` (cached prefix);
// everything per-note lives in the user prompt builders.

import type { BodyNode, Doc, Show, ShotHeader } from "../scene/ast.ts";
import type { Compiled } from "../scene/compile.ts";
import { librarySets, printNode, structure } from "../scene/parse.ts";
import {
  ALL_SHOT_KINDS, AMBIENCE, BLOCKING_VERBS, CAMERA_MOVES, LIGHT_MOODS, MOVE_SPEEDS, MUSIC_CUES, PERFORMANCE_VERBS,
  PHYSICS, SFX, SHOT_SIZES, SHOT_TYPES,
} from "../scene/registry.ts";
import type { QcIssue } from "../qc/checks.ts";
import { ROLES } from "./roles.ts";
import type { RoleId } from "../scene/registry.ts";

export const CREW_RULES = `You are part of Crew, an AI film crew that takes direction from a human director.
A film is SCENE source compiled into 3D. Every line has an address, and a note changes exactly what was asked and nothing else.

How the crew works:
- Each role may only write its own line types. The schema you answer in enforces this.
- Patches are line ops against addresses from the listing (e.g. 1D.2). Addresses always refer to the listing you were shown.
- Return 2 or 3 takes. Each take states its purpose in one sentence, in story terms ("lets the guilt land"), not mechanics.
- Default to subtraction: trim before adding, fewer cuts, longer holds, fewer words.
- Smallest change that resolves the note. Never touch shots outside the targets: a locality guard re-renders every shot and rejects any take that changes one the note didn't name.
- Real-world defaults: walking 1.35 m/s, speaking pace from the cast list, real lenses on a ${"36x24"} sensor. Don't write values the Style Bible already supplies.
- If the note would hurt the cut, still offer the takes, and push back with a reason.
- Offer one idea per round that the director didn't ask for. It is not applied.`;

export function grammarCard(): string {
  const verbs = (o: Record<string, { help: string }>) => Object.entries(o).map(([k, v]) => `${k}: ${v.help}`).join("\n  ");
  return `SCENE LANGUAGE REFERENCE

Episode file:
  episode 1 "Title"
  scene 1 kitchen night act 1          scene <n> <set> <day|night|dawn|dusk> [act N]
  1D MCU kiran push.slow lens 50       shot header (column 0): <id> <type> [subjects] [move[.speed]] [lens mm] [angle low|eye|high] [side left|right]
    kiran@counter open fridge.door     body lines are indented, one beat each; actor@anchor pins where the actor is
    kiran shock ~2                     ~N = beat length in seconds
    with sfx sting                     with = starts together with the previous beat
    kiran say "Hi." to mum             dialogue; timing comes from the character's speaking pace
    mum walk kiran 1.2                 number after walk/run = speed in m/s
    light practical                    shot lighting
    trim 0.4 0.8                       cut 0.4s from the head and 0.8s from the tail of this shot
    hold 1                             freeze-extend the end of this shot by 1s

Addresses: "1D" is the header of shot 1D, "1D.2" its second body line.

Shot types: ${ALL_SHOT_KINDS.join(" ")}
  sizes (frame height at subject): ${Object.entries(SHOT_SIZES).map(([k, v]) => `${k} ${v.frame}m`).join(", ")}
  ${Object.entries(SHOT_TYPES).map(([k, v]) => `${k}: ${v.label}`).join("\n  ")}
  no subject = frame everyone present
Camera moves: ${Object.entries(CAMERA_MOVES).map(([k, v]) => `${k} (${v})`).join("; ")}
Move speeds: ${Object.keys(MOVE_SPEEDS).join(" ")}
Light: ${Object.entries(LIGHT_MOODS).map(([k, v]) => `${k} (${v})`).join("; ")}

Blocking verbs (Blocking role):
  ${verbs(BLOCKING_VERBS)}
Performance verbs (Animator role):
  ${verbs(PERFORMANCE_VERBS)}
Dialogue (Writers' room): say whisper shout  "text" [to <char>] [~N]
Sound (Sound role):
  sfx <name> [~N]: ${Object.keys(SFX).join(" ")}
  music <cue>: ${Object.keys(MUSIC_CUES).join(" ")}
  ambience <name>: ${Object.keys(AMBIENCE).join(" ")}
  silence ~N
Edit (Editor role): trim <head> <tail>, hold <seconds>, or delete a shot header to drop the shot.

Show bible sets (show.scene; the crew reads these, people write them):
  include <library-set> [as <id>]    pull in a ready-made set from the library (${librarySets().join(" ")}); anchor/prop/dress lines after it extend it
  set <id> size <w> <d> [open] [entrance <anchor>]    open = outdoors, no walls
  anchor <id> at <x> <z> [face <deg>] [is <prop>]    a stand mark; furniture sits in front of it (chairs, sofas, beds sit on it); is none = no furniture
  dress <prop> at <x> <z> [face <deg>] [height <y> | on <anchor>] [scale <s>]    set dressing with no stand mark; centred on x z, front pointing at face (0 = +z)
  prop <id> at <x> <z> [height <y> | on <anchor>] [is <prop>]    a prop people can take, give, put and open; drawn as the library prop
  face 0 looks toward +z (the default camera); x runs right, z toward the camera.

Patch text (for humans and tools):
  1D.2 ~2.5 -> ~1.5        token edit
  1D.2 = kiran shock ~1.5  replace line
  1D.2 + kiran sigh        insert after line (after a header = first body line)
  1D.2 -                   delete line (delete a header = drop the shot)
  1D ++ 1DA CU mum         new shot after 1D (DP only)

Physics: walk ${PHYSICS.walkSpeed} m/s (foot-slide above ${PHYSICS.maxWalkSpeed}), run ${PHYSICS.runSpeed} m/s, \`walk <char>\` stops ${PHYSICS.conversationDistance}m away, people are ${PHYSICS.personRadius * 2}m wide.
Continuity: characters keep their position, pose, expression and props across cuts within a scene. Changing where someone ends a shot moves where they start the next one; pin them with actor@anchor if that is not wanted.`;
}

export function stableSystem(showSource: string): string[] {
  return [CREW_RULES, grammarCard(), `SHOW BIBLE (show.scene)\n\n${showSource.trim()}`];
}

// ---------------------------------------------------------------- per-call context

export function listing(doc: Doc, c: Compiled, ids: Set<string> | null, withTiming = true): string {
  const st = structure(doc);
  const out: string[] = [];
  for (const sc of st.scenes) {
    out.push(`[scene${sc.node.n}] ${printNode(sc.node)}`);
    for (const shot of sc.shots) {
      const cs = c.shots.find((s) => s.id === shot.id);
      const timing = cs && withTiming ? `   (${cs.cutDur.toFixed(1)}s in the cut, at ${fmtTime(cs.cutStart)})` : "";
      if (ids && !ids.has(shot.id)) { out.push(`[${shot.id}] ${printNode(shot.header)}${timing}  ...`); continue; }
      out.push(`[${shot.id}] ${printNode(shot.header)}${timing}`);
      for (const b of shot.body) {
        const beat = cs?.beats.find((x) => x.addr === b.addr);
        out.push(`[${b.addr}]${printNode(b.node as BodyNode)}${beat && withTiming ? `   @${beat.t0.toFixed(1)}-${beat.t1.toFixed(1)}s` : ""}`);
      }
    }
  }
  return out.join("\n");
}

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export function issuesText(issues: QcIssue[]): string {
  if (!issues.length) return "none";
  return issues.map((i) => `- ${i.severity} [${i.check}] ${i.shot ?? ""}${i.local !== undefined ? ` @${i.local}s` : ""}: ${i.message}`).join("\n");
}

export interface Taste { accepted: string[]; rejected: string[] }

export function proposePrompt(o: {
  role: RoleId; note: string; intent: string; targets: string[]; listingText: string; issues: QcIssue[];
  taste: Taste; failures: string[]; stage: "propose";
}): string {
  const r = ROLES[o.role];
  const parts = [
    `ROLE: ${r.title}. ${r.brief}`,
    `You may write: ${r.owns}.`,
    `NOTE FROM THE DIRECTOR: "${o.note}"`,
    `Goal: ${o.intent}`,
    `Target shots: ${o.targets.join(", ")}. Every op must stay inside these shots.`,
    `EPISODE (target shots expanded, others collapsed):\n${o.listingText}`,
    `QC issues in the target shots:\n${issuesText(o.issues)}`,
  ];
  if (o.taste.accepted.length || o.taste.rejected.length) {
    parts.push(`This director's taste so far:\n${o.taste.accepted.map((a) => `+ accepted: ${a}`).join("\n")}\n${o.taste.rejected.map((a) => `- rejected: ${a}`).join("\n")}`);
  }
  if (o.failures.length) parts.push(`Earlier attempts were rejected by the checks. Do not repeat them:\n${o.failures.map((f) => `- ${f}`).join("\n")}`);
  parts.push("Write 1 to 3 distinct takes, smallest first. One is enough when the note has one obvious answer.");
  return parts.join("\n\n");
}

export function headerSummary(h: ShotHeader): string {
  return printNode(h);
}
