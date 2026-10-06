// A set laid out from reference pictures: Pro looks at the pictures and writes the `set` block for the show bible;
// code checks it (it parses, everything is inside the room, the episode's anchors survive, furniture doesn't pile up);
// failures go back to Pro for up to two repairs. Nothing is written: the result is a proposal the director accepts,
// because people own the show bible.

import type { LLM } from "../claude/llm.ts";
import type { Project } from "../project.ts";
import { parseShow } from "../scene/parse.ts";
import { PROP_META } from "../../library/props/meta.js";

export interface SetProposal { ok: boolean; block: string; problems: string[]; keptAnchors: string[]; attempts: number; error?: string }

const RULES = `Write ONE "set" block in this exact language (metres; x across the room, z towards the camera; the origin is the room centre):
set <id> size <width> <depth> entrance <anchor id>
  anchor <id> at <x> <z> face <degrees> [is <furniture id> | is none]   stand marks; "is" is the furniture a character uses there
  dress <library prop id> at <x> <z> [face <degrees>] [height <metres>] [on <anchor id>]   furniture and set dressing
  prop <name> at <x> <z> [on <anchor id>] [height <metres>]   small props characters handle
Rules: everything inside the room (|x| <= width/2, |z| <= depth/2); walls are at the edges; keep doors and windows on walls;
leave walkable space between anchors; use only prop ids from the list; no comments, no other lines, no code fences.`;

/** The anchors of a set that the episodes refer to: a new layout must keep them, or shots break. */
export function anchorsInUse(p: Project, setId: string): string[] {
  const set = p.show.sets[setId];
  if (!set) return [];
  const text = p.episodeSrc;
  return Object.keys(set.anchors).filter((a) => new RegExp(`(^|[\\s@])${a}\\b`, "m").test(text));
}

export function setBlock(showSrc: string, setId: string): string {
  const lines = showSrc.split("\n"), i = lines.findIndex((l) => new RegExp(`^set\\s+${setId}\\b`).test(l));
  if (i < 0) return "";
  let j = i + 1;
  while (j < lines.length && /^\s+\S/.test(lines[j])) j++;
  return lines.slice(i, j).join("\n");
}

export function replaceSetBlock(showSrc: string, setId: string, block: string): string {
  const old = setBlock(showSrc, setId);
  return old ? showSrc.replace(old, block.trimEnd()) : `${showSrc.trimEnd()}\n\n${block.trimEnd()}\n`;
}

/** Everything code can check about a proposed block, as plain sentences a model can act on. */
export function checkBlock(showSrc: string, setId: string, block: string, keep: string[]): string[] {
  const problems: string[] = [];
  const clean = block.replace(/```\w*/g, "").trim();
  if (!new RegExp(`^set\\s+${setId}\\b`).test(clean)) problems.push(`The block must start with "set ${setId} size <w> <d> entrance <anchor>".`);
  const show = parseShow(replaceSetBlock(showSrc, setId, clean));
  for (const e of show.errors) problems.push(`Line ${e.line}: ${e.message}`);
  const set = show.sets[setId];
  if (!set) return problems.length ? problems : [`No "set ${setId}" was found in the reply.`];
  for (const [id, a] of Object.entries(set.anchors) as [string, { x: number; z: number }][]) {
    if (Math.abs(a.x) > set.w / 2 + 0.05 || Math.abs(a.z) > set.d / 2 + 0.05) problems.push(`Anchor ${id} at ${a.x} ${a.z} is outside the ${set.w} x ${set.d} m room.`);
  }
  const missing = keep.filter((k) => !set.anchors[k]);
  if (missing.length) problems.push(`Keep these anchors, the episode uses them: ${missing.join(", ")}. Move them if you like, but keep the names.`);
  if (set.entrance && !set.anchors[set.entrance]) problems.push(`The entrance "${set.entrance}" is not one of the anchors.`);
  const marks = Object.entries(set.anchors) as [string, { x: number; z: number }][];
  for (let i = 0; i < marks.length; i++) for (let k = i + 1; k < marks.length; k++) {
    const [a, A] = marks[i], [b, B] = marks[k];
    if (Math.hypot(A.x - B.x, A.z - B.z) < 0.45) problems.push(`Anchors ${a} and ${b} are ${Math.hypot(A.x - B.x, A.z - B.z).toFixed(2)} m apart; people need at least 0.45 m.`);
  }
  const dress = ((set as unknown as { dress?: { kind: string; x: number; z: number; on?: string | null }[] }).dress ?? []).filter((d) => !d.on);
  const foot = (d: { kind: string; x: number; z: number }) => { const s = (PROP_META as Record<string, { size?: number[]; placement?: string }>)[d.kind]; return s?.size && !["wall", "ceiling", "flat", "onSurface"].includes(s.placement ?? "") ? { x0: d.x - s.size[0] / 2, x1: d.x + s.size[0] / 2, z0: d.z - s.size[2] / 2, z1: d.z + s.size[2] / 2 } : null; };
  for (let i = 0; i < dress.length; i++) for (let k = i + 1; k < dress.length; k++) {
    const a = foot(dress[i]), b = foot(dress[k]);
    if (!a || !b) continue;
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
    if (ox > 0.1 && oz > 0.1) problems.push(`${dress[i].kind} and ${dress[k].kind} overlap by ${ox.toFixed(2)} x ${oz.toFixed(2)} m; move one.`);
  }
  return problems;
}

/** Pro lays the set out from the pictures; returns a checked block, or the problems that remained. */
export async function proposeSetLayout(llm: LLM, p: Project, req: { setId: string; images: { mimeType: string; data: string }[]; note?: string }, emit: (m: string) => void = () => {}): Promise<SetProposal> {
  const keep = anchorsInUse(p, req.setId);
  const current = setBlock(p.showSrc, req.setId);
  const props = Object.entries(PROP_META as Record<string, { title?: string; placement?: string; size?: number[] }>).map(([id, m]) => `${id} (${m.title ?? id}; ${m.placement ?? "?"}; ${m.size?.map((x) => x.toFixed(2)).join("x") ?? "?"} m)`).join("\n");
  let prompt = `${RULES}\n\nTHE CURRENT SET:\n${current || `(none yet; create "set ${req.setId}")`}\n\nANCHORS THE EPISODE USES (keep these names): ${keep.join(", ") || "none"}\n\nLIBRARY PROPS YOU MAY DRESS WITH (id, what it is, placement, size w x h x d):\n${props}\n\n${req.note ? `DIRECTOR'S NOTE: ${req.note}\n\n` : ""}Look at the reference pictures and lay this set out so it feels like them: the room's size and shape, where the furniture and dressing go, what kind of things fill it. Reply with the set block only.`;
  let block = "", problems: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    emit(attempt === 1 ? "laying out the set from your pictures" : `fixing the layout (round ${attempt - 1})`);
    const r = await llm.call({ task: "plan", role: "director", tier: "opus", system: ["You are the production designer on an animated film. You read reference pictures and turn them into a set layout in a small text language."], prompt, images: req.images, maxTokens: 8000 });
    if (!r.ok) return { ok: false, block, problems, keptAnchors: keep, attempts: attempt, error: r.error };
    block = r.text.replace(/```\w*\n?/g, "").replace(/```/g, "").trim();
    problems = checkBlock(p.showSrc, req.setId, block, keep);
    if (!problems.length) return { ok: true, block, problems, keptAnchors: keep, attempts: attempt };
    prompt = `${prompt}\n\nYOUR LAST BLOCK:\n${block}\n\nIT HAS THESE PROBLEMS, fix all of them and reply with the whole block again:\n${problems.map((x) => `- ${x}`).join("\n")}`;
  }
  return { ok: false, block, problems, keptAnchors: keep, attempts: 3, error: "the layout still has problems after two repairs" };
}
