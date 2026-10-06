// Crew as an MCP server. Claude Code / Claude Desktop (or any MCP client) can
// read the episode with line addresses, patch it through the same permissions,
// locality guard and QC as the built-in crew, run notes, and screen the cut.
//
//   claude mcp add crew -- npx tsx /path/to/crew/src/cli.ts mcp shows/kitchen
//
// stdout is the protocol channel: never print to it from here.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Crew } from "./index.ts";
import type { Evaluation } from "./crew/guard.ts";
import { grammarCard } from "./crew/prompts.ts";
import { ROLES } from "./crew/roles.ts";
import { summarize } from "./qc/checks.ts";
import { LIBRARY_DIR, type NoteRecord } from "./project.ts";
import { getAsset, loadCatalog, searchCatalog } from "./library/catalog.ts";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const ROLE_IDS = ["director", "writer", "blocking", "dp", "animator", "editor", "sound"] as const;

export function fmtEval(ev: Evaluation & { committed?: boolean }): string {
  const out: string[] = [];
  out.push(ev.ok ? (ev.committed ? "APPLIED" : "PASSES (dry run, not applied)") : "REJECTED");
  if (ev.reasons.length) out.push(...ev.reasons.map((r) => `  - ${r}`));
  if (ev.changes.length) out.push("changes:", ...ev.changes.map((c) => `  ${c.addr}: ${c.before ?? "(new)"}  ->  ${c.after ?? "(deleted)"}`));
  if (ev.changedShots.length) out.push(`shots that render differently: ${ev.changedShots.join(", ")}`);
  if (ev.fixedIssues.length) out.push("QC fixed:", ...ev.fixedIssues.map((i) => `  - ${i.message}`));
  if (ev.newIssues.length) out.push("QC new:", ...ev.newIssues.map((i) => `  - ${i.severity}: ${i.message}`));
  return out.join("\n");
}

export function fmtNote(n: NoteRecord): string {
  const out = [`note ${n.id} [${n.status}] -> ${n.roles.join(" + ")} on ${n.targets.join(", ") || "?"}  ($${n.cost.toFixed(4)}, ${n.mode})`, n.message];
  if (n.pushback) out.push(`pushback: ${n.pushback}`);
  for (const t of n.takes) out.push(`\n${t.id}: ${t.purpose}\n${t.patch.split("\n").map((l) => "  " + l).join("\n")}\n  renders differently: ${t.changedShots.join(", ")}${t.fixed.length ? `; fixes: ${t.fixed.join("; ")}` : ""}${t.added.length ? `; new: ${t.added.join("; ")}` : ""}`);
  if (n.idea) out.push(`\nidea (not applied): ${n.idea}`);
  if (!n.takes.length && n.rejected.length) out.push(`\nrejected candidates:\n${n.rejected.slice(0, 6).map((r) => `  - [${r.tier}] ${r.reason}`).join("\n")}`);
  return out.join("\n");
}

export async function runMcp(dir: string) {
  const crew = Crew.open(dir);
  const server = new McpServer({ name: "crew", version: "0.1.0" }, {
    instructions: `Crew: an AI film crew. The film is SCENE source compiled to a 3D animatic.
Read crew_overview first (line addresses + timing), then change things with crew_patch using the narrowest role that owns the lines.
Every patch is checked: role permissions, grammar, a locality guard (no shot you didn't touch may change) and QC. Rejections explain why.
For open-ended direction, crew_note runs the internal crew (Haiku/Sonnet/Opus) and returns takes to crew_accept.`,
  });

  server.registerTool("crew_overview", {
    title: "Episode overview",
    description: "The episode as SCENE with line addresses, cut timing per shot and per beat, plus a QC summary. Pass shot ids to collapse everything else.",
    inputSchema: { shots: z.array(z.string()).optional().describe("only expand these shots, e.g. [\"1D\"]") },
    annotations: { readOnlyHint: true },
  }, async ({ shots }) => {
    const p = crew.project;
    const m = p.metrics();
    return text(`${p.show.title} / ${p.episodeFile}  (${crew.compiled.duration.toFixed(1)}s, ${crew.compiled.shots.length} shots, crew mode: ${crew.llm.mode})\nQC: ${summarize(crew.qc)}\nnote resolution: ${m.resolutionRate === null ? "n/a" : `${Math.round(m.resolutionRate * 100)}%`} of ${m.closed} closed notes\n\n${crew.overview(shots)}`);
  });

  server.registerTool("crew_grammar", {
    title: "SCENE grammar",
    description: "The SCENE language reference card, the show bible, and which crew role owns which lines.",
    annotations: { readOnlyHint: true },
  }, async () => text(`${grammarCard()}\n\nROLES\n${Object.values(ROLES).map((r) => `${r.id}: ${r.owns}`).join("\n")}\n\nSHOW BIBLE\n${crew.project.showSrc}`));

  server.registerTool("crew_check", {
    title: "QC report",
    description: "Run every code check (framing, intersection, foot slide, eyelines, 180 rule, continuity, timing) and list issues plus what is not checked.",
    annotations: { readOnlyHint: true },
  }, async () => {
    const q = crew.qc;
    return text(`${summarize(q)}\n\n${q.issues.map((i) => `${i.severity.padEnd(5)} [${i.check}] ${i.addr ?? ""}${i.local !== undefined ? ` @${i.local}s` : ""}  ${i.message}`).join("\n") || "no issues"}\n\nchecked: ${q.checked.join("; ")}\nNOT checked: ${q.notChecked.join("; ")}`);
  });

  server.registerTool("crew_patch", {
    title: "Patch the episode",
    description: "Apply line-addressed SCENE edits. One op per line: `1D.2 ~2.5 -> ~1.5` (token edit), `1D.2 = <line>` (replace), `1D.2 + <line>` (insert after), `1D.2 -` (delete; a header deletes the shot), `1D ++ <header>` (new shot). Checked against role permissions, grammar, the locality guard and QC before anything is written.",
    inputSchema: {
      patch: z.string().describe("one op per line"),
      role: z.enum(ROLE_IDS).default("director").describe("the crew role making the change; non-director roles can only touch their own lines"),
      dry_run: z.boolean().default(false),
      allow_spill: z.boolean().default(false).describe("let the change ripple into other shots (e.g. continuity) instead of being rejected"),
    },
  }, async ({ patch, role, dry_run, allow_spill }) => text(fmtEval(crew.patch(patch, { role, dryRun: dry_run, allowSpill: allow_spill, source: "mcp" }))));

  server.registerTool("crew_note", {
    title: "Give the crew a note",
    description: "Hand a director's note (\"1D 0:03, too long\", \"play 1E from Kiran's side\") to the built-in crew. Returns 2-3 takes that already passed every check; nothing is applied until crew_accept.",
    inputSchema: { note: z.string(), follow_up_of: z.string().optional().describe("note id this one revises (counts as another round)") },
  }, async ({ note, follow_up_of }) => text(fmtNote(await crew.note(note, { parent: follow_up_of }))));

  server.registerTool("crew_accept", {
    title: "Accept a take",
    description: "Apply one take from a note. It is re-checked against the current episode first.",
    inputSchema: { note_id: z.string(), take_id: z.string() },
  }, async ({ note_id, take_id }) => {
    try {
      const r = crew.accept(note_id, take_id);
      return text(fmtEval({ ...r.evaluation, committed: true }));
    } catch (e) { return { ...text((e as Error).message), isError: true }; }
  });

  server.registerTool("crew_reject", {
    title: "Reject a note's takes",
    description: "None of the takes work. Recorded as taste so the crew learns.",
    inputSchema: { note_id: z.string() },
  }, async ({ note_id }) => text(`rejected ${crew.reject(note_id).id}`));

  server.registerTool("crew_undo", { title: "Undo", description: "Revert the last applied change.", inputSchema: {} }, async () => {
    const h = crew.undo();
    return text(h ? `reverted ${h.id}: ${h.summary}` : "nothing to undo");
  });

  server.registerTool("crew_set_episode", {
    title: "Replace episode source",
    description: "Replace the whole episode with new SCENE text (for big rewrites). Grammar errors are reported, not hidden. Prefer crew_patch for anything local.",
    inputSchema: { scene: z.string() },
  }, async ({ scene }) => {
    crew.setEpisode(scene, "mcp");
    const g = crew.project.ws.grammar;
    return text(`episode replaced: ${crew.compiled.shots.length} shots, ${crew.compiled.duration.toFixed(1)}s. ${g.length ? `${g.length} grammar errors:\n${g.map((x) => `  ${x.addr}: ${x.message}`).join("\n")}` : "grammar clean."} QC: ${summarize(crew.qc)}`);
  });

  server.registerTool("crew_shot_state", {
    title: "Inspect a moment",
    description: "Positions (metres), facing (degrees), pose, expression and camera for every character at a moment in a shot. Use it to reason about blocking and framing numerically.",
    inputSchema: { shot: z.string(), t: z.number().default(0).describe("seconds into the shot") },
    annotations: { readOnlyHint: true },
  }, async ({ shot, t }) => {
    const c = crew.compiled;
    const s = c.shots.find((x) => x.id === shot);
    if (!s) return { ...text(`no shot ${shot}`), isError: true };
    const deg = (r: number) => Math.round((r * 180) / Math.PI);
    const rows = c.presentIn(s).map((id) => {
      const st = c.charAt(s, t, id);
      return `${id}: ${st.present ? "on set" : "off"} at (${st.x.toFixed(2)}, ${st.z.toFixed(2)}) facing ${deg(st.yaw)}° head ${deg(st.head)}°, ${["standing", "sitting", "kneeling", "leaning"][st.pose]}${st.poseAmt < 1 && st.pose ? ` (${Math.round(st.poseAmt * 100)}%)` : ""}, ${st.expr}${st.look ? `, looking at ${st.look}` : ""}${st.talk ? ", talking" : ""}${st.walk >= 0 ? `, moving ${st.speed.toFixed(2)} m/s` : ""}`;
    });
    const cam = c.camAt(s, t);
    return text(`${shot} @ ${t}s of ${s.dur.toFixed(2)}s (${s.label}, ${s.lens}mm, ${s.move})\ncamera at (${cam.pos.map((v) => v.toFixed(2)).join(", ")}) aiming (${cam.target.map((v) => v.toFixed(2)).join(", ")}), vertical fov ${cam.fov.toFixed(1)}°\n${rows.join("\n")}`);
  });

  server.registerTool("crew_voices", {
    title: "Render temp voices",
    description: "Synthesise every dialogue line with each character's voice design (Kokoro blends, or walla placeholders offline), analyse mouth shapes from the audio, and retime the cut to the real durations. Cached by content: only changed lines re-render.",
    inputSchema: { engine: z.enum(["kokoro", "walla", "command"]).optional(), force: z.boolean().default(false) },
  }, async ({ engine, force }) => {
    const r = await crew.voices({ engine, force });
    return text(`${r.engine}: ${r.made} rendered, ${r.cached} cached, ${r.failed.length} failed. Cut ${r.durationBefore.toFixed(1)}s -> ${r.durationAfter.toFixed(1)}s${r.failed.map((f) => `\n  failed: ${f.line}: ${f.error}`).join("")}`);
  });

  server.registerTool("crew_screen", {
    title: "Test screening",
    description: "Synthetic viewers (Haiku personas) watch the cut and report per-shot confusion and boredom, and whether they can say what the character wants.",
    inputSchema: { viewers: z.number().int().min(1).max(5).default(5) },
  }, async ({ viewers }) => {
    const r = await crew.screen(viewers);
    return text(`${Math.round(r.understoodShare * 100)}% could say what the character wants (${r.mode}, $${r.cost.toFixed(4)})\n${r.viewers.map((v) => `- ${v.persona}: ${v.wants}`).join("\n")}\n\nper shot (confusion / boredom, 0-3):\n${r.shots.map((s) => `${s.id}: ${s.confusion} / ${s.boredom}${s.notes.length ? `  ${s.notes.join(" | ")}` : ""}`).join("\n")}`);
  });

  server.registerTool("crew_library", {
    title: "Search the asset library",
    description: "Find characters (GLB, rigs, looks), poses, music, voice designs, London map data, shader effects, film kits, props (86 models: furniture, vehicles, trees, street furniture, London landmarks) and ready-made sets (kind set: use with `include <set>` in show.scene) from earlier projects. Empty query lists everything. Use an id for full details (files, URLs, exports, metadata).",
    inputSchema: { query: z.string().default(""), kind: z.enum(["character", "music", "data", "voices", "looks", "poses", "rig", "kit", "effect", "reference", "prop", "set"]).optional(), id: z.string().optional() },
    annotations: { readOnlyHint: true },
  }, async ({ query, kind, id }) => {
    const cat = loadCatalog(LIBRARY_DIR);
    if (id) { const a = getAsset(cat, id); return a ? text(JSON.stringify(a, null, 2)) : { ...text(`no asset ${id}`), isError: true }; }
    const hits = searchCatalog(cat, query, { kind });
    return text(hits.map((a) => `${a.id.padEnd(24)} ${a.kind.padEnd(10)} ${a.title}  [${a.tags.join(", ")}]`).join("\n") || "nothing found");
  });

  server.registerTool("crew_export_otio", {
    title: "Export the cut",
    description: "The current cut as OpenTimelineIO JSON (clips reference content-hashed renders).",
    annotations: { readOnlyHint: true },
  }, async () => text(JSON.stringify(crew.otio(), null, 2)));

  server.registerResource("grammar", "crew://grammar", { title: "SCENE grammar", mimeType: "text/plain" }, async (uri) => ({ contents: [{ uri: uri.href, text: grammarCard() }] }));
  server.registerResource("episode", "crew://episode", { title: "Episode source", mimeType: "text/plain" }, async (uri) => ({ contents: [{ uri: uri.href, text: crew.source }] }));
  server.registerResource("show", "crew://show", { title: "Show bible", mimeType: "text/plain" }, async (uri) => ({ contents: [{ uri: uri.href, text: crew.project.showSrc }] }));

  server.registerPrompt("direct", {
    title: "Direct the crew",
    description: "Work a director's note through Crew with the smallest local change.",
    argsSchema: { note: z.string() },
  }, ({ note }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Director's note: "${note}"\n\n1. Call crew_overview for the shots involved.\n2. Decide which role owns the fix (writer, blocking, dp, animator, editor, sound).\n3. Dry-run 2-3 alternative patches with crew_patch (dry_run: true, role set), smallest first, defaulting to subtraction.\n4. Report each take's purpose in one sentence and what it changed, recommend one, push back if the note would hurt the cut, and offer one idea I didn't ask for.\n5. Apply only the take I pick.` } }],
  }));

  await server.connect(new StdioServerTransport());
}
