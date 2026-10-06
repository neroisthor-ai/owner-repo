// The director's exam: every job Pro does in the guided pipeline, on hard cases, scored automatically.
//   plan      ambiguous notes that need two roles, or where the quick read picked the wrong role
//   debug     Flash keeps failing (including the subtle cross-the-cut continuity trap); Pro must write a take that passes
//   review    takes that all pass the code checks but don't all do the note: a lying purpose line, the opposite change,
//             the wrong line, a broken "keep", a wrong tone, and a set where every take is wrong (must ask for a redo)
//   pushback  a note that would hurt the film; Pro should say so
//   outline   a two-scene script; every line of dialogue must survive word for word, with sane coverage
//
// Pro runs inside the real pipeline with the real prompts. Only the Flash-Lite and Flash steps are scripted, so each
// case puts Pro in exactly the situation it tests. Usage:
//   npx tsx scripts/pro-exam.ts [gemini|claude|relay] [--only plan,review] [--json out.json]
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Crew, type LLM, type LLMCall, type LLMResult } from "../src/index.ts";
import { CREW_ROOT } from "../src/project.ts";
import { pickLLM } from "../src/index.ts";
import { parsePatch } from "../src/scene/patch.ts";
import { evaluate } from "../src/crew/guard.ts";
import { cleanOrder, cleanPatch } from "../src/crew/guided.ts";
import { writeEpisodeGuided } from "../src/crew/guided-writers.ts";
import type { RoleId } from "../src/scene/registry.ts";
import { relayLLM } from "./relay.ts";
import { extractJson, validateAndCoerce } from "../src/llm/json.ts";

try { process.loadEnvFile(join(CREW_ROOT, ".env")); } catch { /* keys may come from the environment */ }
const args = process.argv.slice(2);
const choice = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")))[0] ?? "gemini";
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const out = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const dump = args.includes("--dump") ? args[args.indexOf("--dump") + 1] : null;
const answers = args.includes("--answers") ? args[args.indexOf("--answers") + 1] : null;
const real: LLM = dump || answers ? { mode: "gemini", modelFor: () => "gemini-3.1-pro-preview", call: async () => { throw new Error("no live model in paste mode"); } } : choice === "relay" ? relayLLM() : pickLLM(choice as "gemini" | "claude");
let caseId = "";

/**
 * Paste mode. --dump writes each case's Pro prompt to <dir>/<case>.prompt.md for you to paste into Gemini;
 * --answers reads Gemini's reply from <dir>/<case>.reply.txt and scores it. Either way Pro sees exactly what the pipeline sends.
 */
async function proCall<T>(c: LLMCall): Promise<LLMResult<T>> {
  if (dump) {
    mkdirSync(dump, { recursive: true });
    const shape = c.schema ? `\n\n---\nREPLY FORMAT: reply with only a JSON object (no code fences, no prose) matching this JSON Schema:\n${JSON.stringify(c.schema, null, 1)}` : "";
    writeFileSync(join(dump, `${caseId}.prompt.md`), `# Case ${caseId}\n\nPaste everything below the line into Gemini 3.1 Pro (thinking on high), then save its whole reply as ${caseId}.reply.txt next to this file.\n\n---\n\nSYSTEM INSTRUCTIONS:\n\n${c.system.join("\n\n")}\n\n---\n\nREQUEST:\n\n${c.prompt}${shape}\n`);
    throw new Captured({ error: "dumped" });
  }
  if (answers) {
    const f = join(answers, `${caseId}.reply.txt`);
    if (!existsSync(f)) return { ok: false, data: null, text: "", model: "pasted", tier: c.tier, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, ms: 0, error: `no reply file ${f}` };
    const text = readFileSync(f, "utf8");
    const ex = extractJson(text);
    const data = ex.ok && c.schema ? validateAndCoerce(c.schema, ex.value).value : ex.ok ? ex.value : null;
    return { ok: !!data || !c.schema, data: data as T, text, model: "pasted", tier: c.tier, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, ms: 0, error: ex.ok ? undefined : ex.error };
  }
  return real.call<T>(c);
}

class Captured extends Error { constructor(public data: unknown) { super("captured"); } }
const fresh = () => { const d = mkdtempSync(join(tmpdir(), "crew-exam-")); cpSync(join(CREW_ROOT, "shows", "kitchen"), d, { recursive: true, filter: (s) => !s.includes(".crew") }); return d; };
const ok = <T>(c: LLMCall, data: T): LLMResult<T> => ({ ok: true, data, text: "", model: "scripted", tier: c.tier, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, ms: 0 });
const takes = (...t: [string, string][]) => ({ takes: t.map(([purpose, patch]) => ({ purpose, patch })), pushback: null, idea: null });

/** Pro is real; Lite and Flash follow the case's script; `stopAt` captures Pro's answer for that task and ends the run. */
function examLLM(o: { route: { shots: string[]; roles: string[] }; build: (c: LLMCall, n: number) => unknown; stopAt: string; plan?: unknown }): LLM {
  let builds = 0;
  return {
    mode: "gemini",
    modelFor: (t) => real.modelFor?.(t) ?? "",
    async call<T>(c: LLMCall): Promise<LLMResult<T>> {
      if (c.tier === "opus" && c.task === "plan" && o.plan) return ok(c, o.plan) as LLMResult<T>; // isolate the step under test
      if (c.tier === "opus") {
        const r = await proCall<T>(c);
        if (c.task === o.stopAt) throw new Captured(r.ok ? r.data : { error: r.error });
        return r;
      }
      if (c.task === "route") return ok(c, { ...o.route, intent: c.prompt.match(/NOTE: "([^"]+)"/)?.[1] ?? "" }) as LLMResult<T>;
      if (c.task === "rank") return ok(c, { order: [1, 2, 3, 4], why: "as given" }) as LLMResult<T>;
      if (c.task === "build") return ok(c, o.build(c, ++builds)) as LLMResult<T>;
      return ok(c, null) as LLMResult<T>;
    },
  };
}

interface Check { name: string; pass: boolean; detail?: string }
interface Case { id: string; skill: "plan" | "debug" | "review" | "pushback" | "outline"; run: () => Promise<Check[]> }

async function capture(note: string, llm: LLM): Promise<unknown> {
  try { await Crew.open(fresh(), { llm }).note(note); return { error: "Pro was never asked (the pipeline finished without reaching this step)" }; }
  catch (e) { if (e instanceof Captured) return e.data; throw e; }
}

// ---------------------------------------------------------------- plan

const planCase = (id: string, note: string, route: { shots: string[]; roles: string[] }, want: { shots: string[]; roles: RoleId[]; anyRole?: boolean }): Case => ({
  id, skill: "plan",
  run: async () => {
    const d = (await capture(note, examLLM({ route, build: () => takes(), stopAt: "plan" }))) as { shots?: string[]; roles?: string[]; brief?: string; keep?: string; success?: string; error?: string };
    if (d?.error) return [{ name: "answered", pass: false, detail: d.error }];
    const roles = d.roles ?? [];
    return [
      { name: "right shots", pass: want.shots.every((s) => d.shots?.includes(s)) && (d.shots ?? []).every((s) => want.shots.includes(s)), detail: (d.shots ?? []).join(",") },
      { name: want.anyRole ? "a right role" : "all the right roles", pass: want.anyRole ? roles.some((r) => (want.roles as string[]).includes(r)) : want.roles.every((r) => roles.includes(r)), detail: roles.join("+") },
      { name: "concrete brief (names a line or a time)", pass: /\b\d[A-Z]\.\d\b|\b\d+(\.\d+)?\s?s\b|~\d/.test(d.brief ?? ""), detail: d.brief },
      { name: "says what to keep", pass: (d.keep ?? "").trim().length > 8, detail: d.keep },
      { name: "says how to tell it worked", pass: (d.success ?? "").trim().length > 8, detail: d.success },
    ];
  },
});

// ---------------------------------------------------------------- debug

const debugCase = (id: string, note: string, route: { shots: string[]; roles: string[] }, badPatch: string, role: RoleId, test: RegExp, testName: string): Case => ({
  id, skill: "debug",
  run: async () => {
    const plan = { ...route, intent: note, brief: `Do what the note says on ${route.shots.join(", ")}.`, keep: "everything the note doesn't mention", success: "the note is visibly done and nothing else changed" };
    const d = (await capture(note, examLLM({ route, plan, build: () => takes(["the builder's attempt", badPatch]), stopAt: "repair" }))) as { takes?: { purpose?: string; patch?: string }[]; error?: string };
    if (d?.error) return [{ name: "answered", pass: false, detail: d.error }];
    const crew = Crew.open(fresh(), { llm: "offline" });
    const results = (d.takes ?? []).map((t) => {
      const { text } = cleanPatch(t.patch ?? "");
      try { const ev = evaluate(crew.project.ws, parsePatch(text), { role, allowed: new Set(route.shots), requireChange: true }); return { text, ok: ev.ok, why: ev.reasons[0] ?? "" }; }
      catch (e) { return { text, ok: false, why: (e as Error).message }; }
    });
    const good = results.filter((r) => r.ok);
    return [
      { name: "at least one take passes every check", pass: good.length > 0, detail: results.map((r) => `${r.ok ? "ok" : "x"} ${r.text.replace(/\n/g, " | ")}${r.ok ? "" : ` (${r.why})`}`).join(" || ") },
      { name: testName, pass: good.some((r) => test.test(r.text)), detail: good.map((r) => r.text.replace(/\n/g, " | ")).join(" || ") },
      { name: "most takes pass", pass: good.length >= Math.ceil(results.length / 2), detail: `${good.length}/${results.length}` },
    ];
  },
});

// ---------------------------------------------------------------- review

type Take = { purpose: string; patch: string; good: boolean };
const reviewCase = (id: string, note: string, route: { shots: string[]; roles: string[] }, ts: Take[], skill: "review" | "pushback" = "review"): Case => ({
  id, skill,
  run: async () => {
    // every trap must pass the code checks for the role it is built under, or the case tests nothing
    const ws = Crew.open(fresh(), { llm: "offline" }).project.ws;
    const broken = ts.filter((t) => { try { return !evaluate(ws, parsePatch(t.patch), { role: route.roles[0] as RoleId, allowed: new Set(route.shots), requireChange: true }).ok; } catch { return true; } });
    if (broken.length) return [{ name: "case is valid", pass: false, detail: `trap takes fail the checks: ${broken.map((t) => t.patch).join(" || ")}` }];
    const plan = { ...route, intent: note, brief: `Do exactly what the note says on ${route.shots.join(", ")}.`, keep: "everything the note doesn't mention", success: "the note is visibly done and nothing else changed" };
    const d = (await capture(note, examLLM({ route, plan, build: () => takes(...ts.map((t) => [t.purpose, t.patch] as [string, string])), stopAt: "review" }))) as { order?: number[]; fits?: boolean[]; redo?: string | null; pushback?: string | null; message?: string; error?: string };
    if (d?.error) return [{ name: "answered", pass: false, detail: d.error }];
    const order = cleanOrder(d.order, ts.length);
    const fits = new Array(ts.length).fill(null);
    order.forEach((i, k) => { fits[i] = d.fits?.[k] ?? null; });
    const anyGood = ts.some((t) => t.good);
    const checks: Check[] = ts.map((t, i) => ({ name: `take ${i + 1} (${t.good ? "does the note" : "trap"}: ${t.purpose})`, pass: fits[i] === t.good, detail: `fits=${fits[i]}` }));
    if (anyGood) checks.push({ name: "best take is one that does the note", pass: ts[order[0]].good, detail: `picked ${order[0] + 1}` });
    else checks.push({ name: "asks for a redo when nothing fits", pass: (d.redo ?? "").trim().length > 10, detail: d.redo ?? "null" });
    if (skill === "pushback") checks.push({ name: "pushes back on a note that hurts the film", pass: (d.pushback ?? "").trim().length > 10, detail: d.pushback ?? "null" });
    return checks;
  },
});

// ---------------------------------------------------------------- outline

const SCRIPT = `INT. KITCHEN - NIGHT
KIRAN (16) creeps in and opens the fridge. MUM is at the table in the dark.
MUM: Hungry?
KIRAN: (startled) I was just getting water.
MUM: From the cake?
He freezes. She smiles.

INT. KITCHEN - DAWN
Kiran is asleep at the table. Mum puts a plate with the last slice of cake beside him.
MUM: (softly) Happy birthday.`;
const LINES = ["Hungry?", "I was just getting water.", "From the cake?", "Happy birthday."];

const outlineCase: Case = {
  id: "outline-two-scenes", skill: "outline",
  run: async () => {
    const crew = Crew.open(fresh(), { llm: "offline" });
    const llm: LLM = { mode: "gemini", modelFor: (t) => real.modelFor?.(t) ?? "", call: async <T>(c: LLMCall) => { if (c.task === "outline") { const r = await proCall<T>(c); throw new Captured(r.ok ? r.data : { error: r.error }); } return ok(c, null) as LLMResult<T>; } };
    let d: { scenes?: { set: string; time: string; shots: { id: string; type: string; subjects: string[]; beat: string }[] }[]; error?: string } = {};
    try { await writeEpisodeGuided(crew.project, SCRIPT, llm); } catch (e) { if (e instanceof Captured) d = e.data as typeof d; else throw e; }
    if (d?.error || !d?.scenes) return [{ name: "answered", pass: false, detail: d?.error ?? "no outline" }];
    const shots = d.scenes.flatMap((s) => s.shots ?? []);
    const beats = shots.map((s) => s.beat ?? "").join("\n");
    return [
      { name: "two scenes (night, then dawn)", pass: d.scenes.length === 2 && d.scenes[0].time === "night" && d.scenes[1].time === "dawn", detail: d.scenes.map((s) => `${s.set}/${s.time}`).join(", ") },
      ...LINES.map((l) => ({ name: `keeps "${l}" word for word`, pass: beats.includes(l) })),
      { name: "enough coverage (5 to 14 shots)", pass: shots.length >= 5 && shots.length <= 14, detail: String(shots.length) },
      { name: "opens each scene wide", pass: d.scenes.every((s) => /^(WS|EWS|LS|MWS|TWO|FS)/.test(s.shots?.[0]?.type ?? "")), detail: d.scenes.map((s) => s.shots?.[0]?.type).join(", ") },
      { name: "the speaker or listener is framed on each line", pass: shots.filter((s) => LINES.some((l) => (s.beat ?? "").includes(l))).every((s) => (s.subjects ?? []).length > 0 || /^(WS|TWO|MS)/.test(s.type)), detail: shots.map((s) => `${s.type} ${(s.subjects ?? []).join("+")}`).join(" / ") },
    ];
  },
};

// ---------------------------------------------------------------- the exam

const CASES: Case[] = [
  planCase("plan-two-roles", "the ending in 1G needs to feel warmer, and mum should get the last laugh, not kiran", { shots: ["1G"], roles: ["editor"] }, { shots: ["1G"], roles: ["animator"], anyRole: true }),
  planCase("plan-wrong-role", "in 1B the fridge should feel like a spotlight on him, he's been caught", { shots: ["1B"], roles: ["sound"] }, { shots: ["1B"], roles: ["dp"] }),
  planCase("plan-two-shots", "1D and 1E: the pause between his excuse and her reply should be twice as long", { shots: ["1D", "1E"], roles: ["writer"] }, { shots: ["1D", "1E"], roles: ["editor", "animator"], anyRole: true }),
  debugCase("debug-continuity", "1B, kiran should look guilty before he takes the cake", { shots: ["1B"], roles: ["animator"] }, "1B.4 + kiran guilty ~1.2", "animator", /guilty/, "the take makes him look guilty"),
  debugCase("debug-bad-address", "1D, the shock should be half as long", { shots: ["1D"], roles: ["animator"] }, "1D.9 ~2.5 -> ~1.2", "animator", /1D\.2 .*~1(\.\d+)?\b/, "the shock beat is about half as long"),
  debugCase("debug-wrong-verb", "1A, kiran should sneak in slowly", { shots: ["1A"], roles: ["blocking"] }, "1A.4 = kiran tiptoe fridge 0.5", "blocking", /walk fridge 0?\.\d/, "his walk is slower than 1.0 m/s"),
  reviewCase("review-lying-purpose", "1D, the shock is too long", { shots: ["1D"], roles: ["animator"] }, [
    { purpose: "Tightens the shock so it snaps", patch: "1D.2 ~2.5 -> ~3.5", good: false },
    { purpose: "A shorter shock", patch: "1D.2 ~2.5 -> ~1.5", good: true },
    { purpose: "Shortens the shock", patch: "1D.4 = kiran guilty ~0.5", good: false },
  ]),
  reviewCase("review-tone", "1C, mum's line is a bit long, make it shorter but keep her warm and teasing", { shots: ["1C"], roles: ["writer"] }, [
    { purpose: "Shorter and blunt", patch: '1C.1 = mum say "Get out." to kiran', good: false },
    { purpose: "Shorter, still teasing", patch: '1C.1 = mum say "Still up?" to kiran', good: true },
    { purpose: "Warmer", patch: `1C.1 = mum say "Couldn't sleep either, love? It's very late, you know." to kiran`, good: false },
  ]),
  reviewCase("review-keep", "1G, kiran laughs too long, but he must still laugh", { shots: ["1G"], roles: ["animator"] }, [
    { purpose: "Cut the laugh so the moment ends cleanly", patch: "1G.3 -", good: false },
    { purpose: "A shorter laugh", patch: "1G.3 = kiran laugh ~0.6", good: true },
    { purpose: "Let the laugh breathe", patch: "1G.3 = kiran laugh ~2.5", good: false },
  ]),
  reviewCase("review-all-wrong", "1B, kiran should look guilty before he takes the cake", { shots: ["1B"], roles: ["animator"] }, [
    { purpose: "Guilty nod", patch: "1B.4 + kiran nod", good: false },
    { purpose: "Nervous laugh", patch: "1B.5 + kiran laugh\n1B.5 + kiran smile", good: false },
  ]),
  reviewCase("pushback-punchline", "1F, cut kiran's line, it's pointless", { shots: ["1F"], roles: ["writer"] }, [
    { purpose: "Cut the line", patch: "1F.2 -", good: true },
    { purpose: "Keep it but make it drier", patch: '1F.2 = kiran say "Suspiciously."', good: false },
  ], "pushback"),
  outlineCase,
];

const results: { id: string; skill: string; checks: Check[]; ms: number }[] = [];
for (const c of CASES.filter((c) => !only || only.includes(c.skill) || only.includes(c.id))) {
  const t0 = Date.now();
  caseId = c.id;
  let checks: Check[];
  try { checks = await c.run(); } catch (e) { checks = [{ name: "ran", pass: false, detail: (e as Error).message }]; }
  results.push({ id: c.id, skill: c.skill, checks, ms: Date.now() - t0 });
  const p = checks.filter((x) => x.pass).length;
  console.log(`\n${p === checks.length ? "PASS" : "FAIL"} ${c.id} (${p}/${checks.length}, ${Math.round((Date.now() - t0) / 1000)}s)`);
  for (const x of checks) console.log(`  ${x.pass ? "✓" : "✗"} ${x.name}${x.detail && !x.pass ? `  [${String(x.detail).slice(0, 200)}]` : ""}`);
}
const by = new Map<string, { p: number; n: number }>();
for (const r of results) { const b = by.get(r.skill) ?? { p: 0, n: 0 }; b.n += r.checks.length; b.p += r.checks.filter((x) => x.pass).length; by.set(r.skill, b); }
if (dump) { console.log(`\nWrote ${results.length} prompts to ${dump}. Paste each into Gemini 3.1 Pro, save the replies as <case>.reply.txt beside them, then run: npx tsx scripts/pro-exam.ts --answers ${dump}`); process.exit(0); }
console.log(`\n${answers ? "pasted Gemini" : choice} director exam: ${[...by].map(([k, v]) => `${k} ${v.p}/${v.n}`).join(", ")}; cases passed ${results.filter((r) => r.checks.every((x) => x.pass)).length}/${results.length}`);
if (out) writeFileSync(out, JSON.stringify({ llm: choice, at: new Date().toISOString(), results }, null, 2));
