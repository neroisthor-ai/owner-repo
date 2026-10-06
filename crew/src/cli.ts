// crew <command> [show dir] [...]
//
//   serve [dir] [--port 4310]       browser animatic + notes UI
//   note "<note>" [--accept]        give the crew a note (prints takes; --accept applies the first)
//   patch "<patch>" [--role dp] [--dry]
//   check | overview [shots..] | undo | grammar
//   write <script.txt> [--apply]    writers' room (needs Claude)
//   voices [--engine kokoro|walla|command] [--force] [--prune]
//                                   temp voices for every line; the cut retimes to them
//   screen [viewers]                synthetic test screening
//   export otio|baked [file]
//   mcp [dir]                       MCP server on stdio for Claude Code / Desktop
//   library list|search <q>|info <id>|build|port|import <bob-dir> <low-pass.html> <Odyssey.html>

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Crew } from "./index.ts";
import { grammarCard } from "./crew/prompts.ts";
import { ROLES } from "./crew/roles.ts";
import { summarize } from "./qc/checks.ts";
import { fmtEval, fmtNote, runMcp } from "./mcp.ts";
import { startServer } from "./server.ts";
import type { RoleId } from "./scene/registry.ts";
import { libraryCmd } from "./library/cli.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--") && ["port", "role", "dir", "episode", "llm", "out", "engine"].includes(k)) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

function showDir(flags: Record<string, string | true>, candidate?: string): string {
  if (typeof flags.dir === "string") return resolve(flags.dir);
  if (candidate && existsSync(join(candidate, "show.scene"))) return resolve(candidate);
  if (process.env.CREW_SHOW) return resolve(process.env.CREW_SHOW);
  if (existsSync("show.scene")) return resolve(".");
  return join(ROOT, "shows", "kitchen");
}

async function main() {
  const [cmd = "help", ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest);
  const open = (dir: string) => Crew.open(dir, { llm: (flags.llm as "claude") ?? undefined, episode: typeof flags.episode === "string" ? flags.episode : undefined });

  switch (cmd) {
    case "serve": {
      const crew = open(showDir(flags, pos[0]));
      const port = Number(flags.port ?? process.env.PORT ?? 4310);
      const { url } = await startServer(crew, port);
      console.log(`Crew is rolling: ${url}`);
      console.log(`  show: ${crew.project.show.title} (${crew.project.dir})`);
      console.log(`  crew: ${crew.llm.mode === "claude" ? "Crew AI (Opus directs, Sonnet builds, Haiku routes)" : "offline heuristics (set ANTHROPIC_API_KEY for Crew AI)"}`);
      crew.events.on("crew", (e) => console.log(`  [${e.role ?? "crew"}${e.tier ? "/" + e.tier : ""}] ${e.message}${e.cost ? `  $${e.cost.toFixed(4)}` : ""}`));
      return;
    }
    case "mcp": return runMcp(showDir(flags, pos[0]));
    case "library": return libraryCmd(pos, flags);
    case "grammar": console.log(grammarCard()); console.log(`\nROLES\n${Object.values(ROLES).map((r) => `  ${r.id.padEnd(9)} ${r.tier.padEnd(6)} ${r.owns}`).join("\n")}`); return;
  }

  const crew = open(showDir(flags));
  switch (cmd) {
    case "check": {
      const q = crew.qc;
      console.log(`${crew.project.show.title}: ${crew.compiled.shots.length} shots, ${crew.compiled.duration.toFixed(1)}s. ${summarize(q)}`);
      for (const i of q.issues) console.log(`  ${i.severity.padEnd(5)} [${i.check}] ${(i.addr ?? "").padEnd(5)} ${i.local !== undefined ? `@${i.local}s ` : ""}${i.message}`);
      console.log(`\nchecked: ${q.checked.join("; ")}\nnot checked: ${q.notChecked.join("; ")}`);
      process.exitCode = q.counts.error ? 1 : 0;
      return;
    }
    case "overview": console.log(crew.overview(pos.length ? pos : undefined)); return;
    case "note": {
      if (!pos[0]) throw new Error('usage: crew note "1D is too long"');
      crew.events.on("crew", (e) => process.stderr.write(`  [${e.role ?? "crew"}${e.tier ? "/" + e.tier : ""}] ${e.message}\n`));
      const n = await crew.note(pos.join(" "));
      console.log(fmtNote(n));
      if (flags.accept && n.takes[0]) {
        const r = crew.accept(n.id, typeof flags.accept === "string" ? `${n.id}-${flags.accept}` : n.takes[0].id);
        console.log(`\n${fmtEval({ ...r.evaluation, committed: true })}`);
      }
      return;
    }
    case "accept": { const r = crew.accept(pos[0], pos[1]); console.log(fmtEval({ ...r.evaluation, committed: true })); return; }
    case "patch": {
      const text = pos[0] === "-" ? readFileSync(0, "utf8") : pos.join("\n");
      const r = crew.patch(text, { role: (flags.role as RoleId) ?? "director", dryRun: !!flags.dry, allowSpill: !!flags["allow-spill"] });
      console.log(fmtEval(r));
      process.exitCode = r.ok ? 0 : 1;
      return;
    }
    case "undo": { const h = crew.undo(); console.log(h ? `reverted: ${h.summary}` : "nothing to undo"); return; }
    case "write": {
      if (!pos[0]) throw new Error("usage: crew write script.txt [--apply]");
      crew.events.on("crew", (e) => process.stderr.write(`  [${e.role}] ${e.message}\n`));
      const r = await crew.write(readFileSync(pos[0], "utf8"), { apply: !!flags.apply });
      if (!r.ok) { console.error(r.error); if (r.errors.length) console.error(r.errors.join("\n")); process.exitCode = 1; }
      console.log(r.text);
      return;
    }
    case "voices": {
      const r = await crew.voices({ engine: typeof flags.engine === "string" ? flags.engine : undefined, force: !!flags.force, prune: !!flags.prune });
      console.log(`${r.engine}: ${r.made} rendered, ${r.cached} cached, ${r.failed.length} failed. Cut ${r.durationBefore.toFixed(1)}s -> ${r.durationAfter.toFixed(1)}s`);
      for (const f of r.failed) console.log(`  failed: ${f.line}: ${f.error}`);
      process.exitCode = r.failed.length ? 1 : 0;
      return;
    }
    case "screen": {
      const r = await crew.screen(pos[0] ? Number(pos[0]) : undefined);
      console.log(`${Math.round(r.understoodShare * 100)}% could say what the character wants (${r.mode}, $${r.cost.toFixed(4)})`);
      for (const v of r.viewers) console.log(`  - ${v.persona}: ${v.wants}`);
      for (const s of r.shots) console.log(`  ${s.id.padEnd(4)} confusion ${s.confusion}  boredom ${s.boredom}  ${s.notes.join(" | ")}`);
      return;
    }
    case "export": {
      const what = pos[0] ?? "otio";
      const data = what === "baked" ? crew.bake() : crew.otio();
      const out = pos[1] ?? (typeof flags.out === "string" ? flags.out : null);
      if (out) { writeFileSync(out, JSON.stringify(data, null, 2)); console.log(`wrote ${out}`); } else console.log(JSON.stringify(data, null, 2));
      return;
    }
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  }
}

main().catch((e) => { console.error(`crew: ${(e as Error).message}`); process.exit(1); });
