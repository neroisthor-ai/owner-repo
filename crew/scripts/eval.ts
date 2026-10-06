// The golden-notes eval: runs every note in test/fixtures/notes.json on a fresh copy of the kitchen show and reports
// how often each crew gets a checked take that touches the right shot. Usage:
//   npx tsx scripts/eval.ts [offline|gemini|claude] [--only N] [--json out.json]
// Live runs need the provider's key in .env. Each note runs on its own copy, so notes never affect each other.
import "../src/env.ts";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Crew, type LLMChoice } from "../src/index.ts";
import { CREW_ROOT } from "../src/project.ts";
import { relayLLM } from "./relay.ts";

try { process.loadEnvFile(join(CREW_ROOT, ".env")); } catch { /* keys may come from the environment */ }
const args = process.argv.slice(2);
const choice = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")))[0] ?? "offline";
const llm = (choice === "relay" ? relayLLM() : choice) as LLMChoice;
const only = args.includes("--only") ? Number(args[args.indexOf("--only") + 1]) : Infinity;
const out = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const pick = args.includes("--pick") ? args[args.indexOf("--pick") + 1].split(",").map(Number) : null;
const all: { note: string; shots: string[]; roles: string[]; patch?: string }[] = JSON.parse(readFileSync(join(CREW_ROOT, "test/fixtures/notes.json"), "utf8"));
const notes = (pick ? pick.map((i) => all[i - 1]).filter(Boolean) : all).slice(0, only);
const SHOW = join(CREW_ROOT, "shows", "kitchen");

const rows = [];
for (const g of notes) {
  const dir = mkdtempSync(join(tmpdir(), "crew-eval-"));
  cpSync(SHOW, dir, { recursive: true, filter: (s) => !s.includes(".crew") });
  const t0 = Date.now();
  let n;
  try { n = await Crew.open(dir, { llm }).note(g.note); } catch (e) { rows.push({ note: g.note, ok: false, why: `crashed: ${(e as Error).message}`, ms: Date.now() - t0 }); continue; }
  const top = n.takes[0];
  const shotOk = !g.shots.length || (n.targets.length > 0 && n.targets.every((s) => g.shots.includes(s)));
  const roleOk = n.roles.some((r) => g.roles.includes(r));
  const localOk = !top || !g.shots.length || top.changedShots.every((s) => g.shots.includes(s));
  const patchOk = !g.patch || (!!top && new RegExp(g.patch).test(top.patch));
  const ok = n.status === "open" && !!top && shotOk && localOk && patchOk;
  rows.push({ note: g.note, ok, status: n.status, targets: n.targets.join(","), roles: n.roles.join("+"), shotOk, roleOk, localOk, patchOk, takes: n.takes.length, rejected: n.rejected.length, top: top ? `${top.tier}: ${top.purpose}` : n.message.slice(0, 80), ms: Date.now() - t0, tokens: n.tokens });
  const last = rows[rows.length - 1] as { ok: boolean; ms: number };
  console.log(`${last.ok ? "PASS" : "FAIL"}  ${String(Math.round(last.ms / 1000)).padStart(4)}s  ${g.note}`);
}
const pass = rows.filter((r) => r.ok).length;
const role = rows.filter((r) => (r as { roleOk?: boolean }).roleOk).length;
console.log(`\n${choice}: ${pass}/${rows.length} notes resolved (${Math.round((100 * pass) / Math.max(1, rows.length))}%), right role ${role}/${rows.length}, ${Math.round(rows.reduce((a, r) => a + r.ms, 0) / 1000)}s total`);
if (out) writeFileSync(out, JSON.stringify({ llm: choice, at: new Date().toISOString(), pass, total: rows.length, rows }, null, 2));
