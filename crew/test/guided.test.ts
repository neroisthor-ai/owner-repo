// The guided pipeline against a model that behaves like a weak one: messy formats, wrong words, bad indices,
// split votes, and outright failure. Every case must end in checked takes or a clear reason, never a crash.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Crew } from "../src/index.ts";
import { cleanOrder, cleanPatch } from "../src/crew/guided.ts";
import { writeEpisodeGuided } from "../src/crew/guided-writers.ts";
import { GeminiLLM, GEMINI_MODELS } from "../src/llm/gemini-llm.ts";
import { GeminiClient } from "../src/llm/gemini.ts";
import type { LLM, LLMCall, LLMResult } from "../src/claude/llm.ts";

const SHOW = join(import.meta.dirname, "..", "shows", "kitchen");
const fresh = () => { const d = mkdtempSync(join(tmpdir(), "crew-")); cpSync(SHOW, d, { recursive: true, filter: (s) => !s.includes(".crew") }); return d; };

type Reply = unknown | { fail: string };
/** A scripted "gemini" model: `script(call, n)` returns the data for the n-th call of that task, or { fail }. */
function scripted(script: (c: LLMCall, n: number) => Reply) {
  const calls: LLMCall[] = [];
  const count = new Map<string, number>();
  const llm: LLM = {
    mode: "gemini",
    async call<T>(c: LLMCall): Promise<LLMResult<T>> {
      calls.push(c);
      const n = (count.get(c.task) ?? 0) + 1;
      count.set(c.task, n);
      const r = script(c, n);
      const base = { text: "", model: `fake-${c.tier}`, tier: c.tier, usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 }, cost: 0, ms: 1 };
      if (r && typeof r === "object" && "fail" in (r as object)) return { ...base, ok: false, data: null, error: (r as { fail: string }).fail };
      return { ...base, ok: true, data: r as T };
    },
  };
  return { llm, calls, tasks: () => calls.map((c) => `${c.task}:${c.tier}`) };
}
const route = (shots: string[], roles: string[]) => ({ shots, roles, intent: "do the note" });
const takes = (...t: [string, string][]) => ({ takes: t.map(([purpose, patch]) => ({ purpose, patch })), pushback: null, idea: null });
const review = (o: Partial<{ order: number[]; fits: boolean[]; message: string; redo: string | null }> = {}) => ({ order: [1, 2, 3], fits: [true, true, true], message: "Take A lands it.", pushback: null, idea: "Try a held beat.", redo: null, ...o });
const plan = { shots: ["1D"], roles: ["animator"], intent: "a shorter shock", brief: "Shorten the shock at 1D.2.", keep: "everything else", success: "the shock is under 2s" };

test("cleanPatch strips fences, bullets, numbering, curly quotes, escaped newlines and joined ops", () => {
  const raw = "```scene\n- 1D.2 ~2.5 -> ~1.5\\n2. 1D.4 = kiran say “Hi.” to mum; 1D.3 -\nHere is my take!\n```";
  const { text, dropped } = cleanPatch(raw);
  assert.equal(text, '1D.2 ~2.5 -> ~1.5\n1D.4 = kiran say "Hi." to mum\n1D.3 -');
  assert.deepEqual(dropped, ["Here is my take!"]);
});

test("cleanOrder: 1-based, 0-based, repeats, junk and gaps all become a full permutation", () => {
  assert.deepEqual(cleanOrder([2, 1, 3], 3), [1, 0, 2]);
  assert.deepEqual(cleanOrder([0, 2], 3), [0, 2, 1]);
  assert.deepEqual(cleanOrder([3, 3, "x", 9, 1], 3), [2, 0, 1]);
  assert.deepEqual(cleanOrder(null, 2), [0, 1]);
});

test("messy but right (strict grip): split votes, a plan, a fenced patch, a sloppy ranking, a review", async () => {
  process.env.CREW_GRIP_READ = "strict"; process.env.CREW_GRIP_RANK = "strict";
  try {
  const s = scripted((c, n) => {
    if (c.task === "route") return n === 3 ? route(["1E"], ["editor"]) : route(["1D"], ["animator"]);
    if (c.task === "plan") return plan;
    if (c.task === "build") return takes(["a faster shock", "```\n- 1D.2 ~2.5 -> ~1.4\n```"], ["a quick double take", "1D.2 ~2.5 -> ~1.8"]);
    if (c.task === "rank") return { order: [2, 2, 1], why: "x" };
    if (c.task === "review") return review({ order: [2, 1] });
  });
  const n = await Crew.open(fresh(), { llm: s.llm }).note("the shock on kiran feels like it goes on forever");
  assert.equal(n.status, "open", n.message);
  assert.deepEqual(n.targets, ["1D"], "majority of the votes");
  assert.deepEqual(n.roles, ["animator"]);
  assert.ok(n.takes.length >= 2);
  assert.ok(n.takes.every((t) => t.changedShots.join() === "1D"));
  assert.equal(n.message, "Take A lands it.");
  assert.ok(s.tasks().includes("plan:opus") && s.tasks().includes("build:sonnet") && s.tasks().includes("review:opus"));
  assert.equal(s.tasks().filter((t) => t === "route:haiku").length, 3, "three votes");
  assert.equal(s.tasks().filter((t) => t === "rank:haiku").length, 3, "three ranking votes");
  const build = s.calls.find((c) => c.task === "build")!;
  assert.match(build.prompt, /THE LINES YOU MAY CHANGE/);
  assert.match(build.prompt, /1D\.2/);
  assert.match(build.prompt, /Shorten the shock at 1D\.2/, "the plan reaches the builder");
  } finally { delete process.env.CREW_GRIP_READ; delete process.env.CREW_GRIP_RANK; }
});

test("a wrong verb is explained in plain words and fixed on repair", async () => {
  const s = scripted((c, n) => {
    if (c.task === "route") return route(["1D"], ["animator"]);
    if (c.task === "plan") return plan;
    if (c.task === "build") return n === 1 ? takes(["bigger shock", "1D.2 = kiran moonwalk ~2"]) : takes(["shorter shock", "1D.2 ~2.5 -> ~1.5"]);
    if (c.task === "review") return review();
    if (c.task === "rank") return { order: [1], why: "" };
  });
  const n = await Crew.open(fresh(), { llm: s.llm }).note("1D the shock beat should feel different, more of a jolt");
  assert.equal(n.status, "open", n.message);
  const repair = s.calls.filter((c) => c.task === "build")[1];
  assert.match(repair.prompt, /YOUR LAST TAKES WERE REJECTED/);
  assert.match(repair.prompt, /moonwalk/);
  assert.ok(n.rejected.some((r) => /moonwalk/.test(r.reason)));
  assert.ok(n.takes.some((t) => /1D\.2/.test(t.patch)));
});

test("when Flash never gets it right, Pro debugs it", async () => {
  const s = scripted((c) => {
    if (c.task === "route") return route(["1D"], ["animator"]);
    if (c.task === "plan") return plan;
    if (c.task === "build") return takes(["nope", "1D.9 = kiran shock ~1"]);
    if (c.task === "repair") return takes(["the director's fix", "1D.2 ~2.5 -> ~1.2"]);
    if (c.task === "review") return review();
  });
  const n = await Crew.open(fresh(), { llm: s.llm }).note("1D the shock reaction drags on and kills the joke");
  assert.equal(s.tasks().filter((t) => t === "build:sonnet").length, 3, "one build and two repairs");
  assert.ok(s.tasks().includes("repair:opus"));
  assert.equal(n.status, "open", n.message);
  assert.equal(n.takes[0].tier, "opus");
  const repair = s.calls.find((c) => c.task === "build" && /REJECTED/.test(c.prompt))!;
  assert.match(repair.prompt, /1D\.9/, "the bad address is named back to the model");
});

test("every model call failing still gives the offline crew's takes for a note it knows", async () => {
  const s = scripted(() => ({ fail: "Gemini is rate limiting; try again shortly" }));
  const n = await Crew.open(fresh(), { llm: s.llm }).note("1A 0:02, kiran clips mum");
  assert.equal(n.status, "open", n.message);
  assert.ok(n.takes.length >= 1);
  assert.equal(n.takes[0].tier, "code");
  assert.deepEqual(n.takes[0].changedShots, ["1A"]);
});

test("the note's own shot ids win over the model's votes and over the plan", async () => {
  const s = scripted((c) => {
    if (c.task === "route") return route(["1E"], ["animator"]);
    if (c.task === "plan") return { ...plan, shots: ["1F"] };
    if (c.task === "build") return takes(["shorter", "1D.2 ~2.5 -> ~1.5"]);
    if (c.task === "review") return review();
  });
  const n = await Crew.open(fresh(), { llm: s.llm }).note("1D the shock reaction should be much quicker and snappier please");
  assert.deepEqual(n.targets, ["1D"]);
});

test("a take that strays into another shot is rejected, explained, and never shown", async () => {
  const s = scripted((c, n) => {
    if (c.task === "route") return route(["1D"], ["animator"]);
    if (c.task === "plan") return plan;
    if (c.task === "build") return n === 1 ? takes(["two shots", "1D.2 ~2.5 -> ~1.5\n1E.1 -"]) : takes(["just 1D", "1D.2 ~2.5 -> ~1.6"]);
    if (c.task === "review") return review();
  });
  const n = await Crew.open(fresh(), { llm: s.llm }).note("1D make the shock shorter but keep the rest of the scene exactly");
  assert.ok(n.takes.every((t) => !/1E/.test(t.patch)));
  assert.match(s.calls.filter((c) => c.task === "build")[1].prompt, /1E/);
});

test("if Pro says no take fits, Flash gets one more round with Pro's words", async () => {
  const s = scripted((c, n) => {
    if (c.task === "route") return route(["1D"], ["animator"]);
    if (c.task === "plan") return plan;
    if (c.task === "build") return n === 1 ? takes(["longer", "1D.2 ~2.5 -> ~3.0"]) : takes(["shorter", "1D.2 ~2.5 -> ~1.4"]);
    if (c.task === "review") return n === 1 ? review({ order: [1], fits: [false], redo: "Make the shock shorter, not longer." }) : review();
  });
  const n = await Crew.open(fresh(), { llm: s.llm }).note("1D the shock should be over faster, it really drags on");
  const redo = s.calls.filter((c) => c.task === "build")[1];
  assert.match(redo.prompt, /Make the shock shorter, not longer/);
  assert.match(n.takes[0].patch, /~1\.4/);
});

test("a plain tweak the code already answers skips the plan", async () => {
  const s = scripted((c) => {
    if (c.task === "route") return route(["1A"], ["blocking"]);
    if (c.task === "build") return { fail: "down" };
    if (c.task === "repair") return { fail: "down" };
  });
  await Crew.open(fresh(), { llm: s.llm }).note("1A 0:02, kiran clips mum");
  assert.ok(!s.tasks().includes("plan:opus"));
});

test("GeminiLLM: each job goes to its model at its thinking level, with room for high thinking", async () => {
  const seen: { model: string; level: string; max: number }[] = [];
  const fake = async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const model = String(url).match(/models\/([^:]+):/)?.[1] ?? "";
    seen.push({ model, level: body.generationConfig?.thinkingConfig?.thinkingLevel, max: body.generationConfig?.maxOutputTokens });
    const reply = model.includes("lite") ? { shots: ["1D"], roles: ["animator"], intent: "x", order: [1], why: "x" } : model.includes("pro") ? { ...plan, ...review() } : takes(["shorter", "1D.2 ~2.5 -> ~1.5"]);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "thinking...", thought: true }, { text: "```json\n" + JSON.stringify(reply) + "\n```" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 50 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const llm = new GeminiLLM({ client: new GeminiClient({ apiKey: "k", fetch: fake as typeof fetch, sleep: async () => {} }) });
  const dir = fresh();
  const n = await Crew.open(dir, { llm }).note("1D the shock reaction goes on far too long for the joke");
  assert.equal(n.status, "open", n.message);
  const by = (m: string) => seen.filter((x) => x.model === m);
  assert.ok(by(GEMINI_MODELS.haiku).length >= 1 && by(GEMINI_MODELS.haiku).every((x) => /^low$/i.test(x.level)));
  assert.ok(by(GEMINI_MODELS.sonnet).length >= 1 && by(GEMINI_MODELS.sonnet).every((x) => /^high$/i.test(x.level) && x.max >= 32000));
  assert.ok(by(GEMINI_MODELS.opus).length >= 1 && by(GEMINI_MODELS.opus).every((x) => /^high$/i.test(x.level)));
  const log = readFileSync(join(dir, ".crew", "llm-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(log.length >= 4 && log.every((e) => e.model && e.task));
});

test("guided writers' room: Pro outlines, Flash writes shots, a bad shot is repaired on its own", async () => {
  const dir = fresh();
  const crew = Crew.open(dir, { llm: "offline" });
  const s = scripted((c, n) => {
    if (c.task === "outline") return { title: "Night Fridge", scenes: [{ set: "kitchen", time: "night", shots: [{ id: "x", type: "WS", subjects: [], beat: "Kiran comes in." }, { id: "y", type: "MCU", subjects: ["kiran", "ghost"], beat: "He says hi." }] }] };
    if (c.task === "shot" && n === 1) return { shots: [{ id: "1A", lines: ["kiran@door enter", "kiran walk fridge"] }, { id: "1B", lines: ["- kiran moonwalk", "kiran say “Hi.”"] }] };
    if (c.task === "shot") return { shots: [{ id: "1B", lines: ["kiran shock ~1", 'kiran say "Hi."'] }] };
  });
  const r = await writeEpisodeGuided(crew.project, "INT. KITCHEN - NIGHT\nKiran sneaks in. He says hi.", s.llm);
  assert.equal(r.ok, true, `${r.error} ${r.errors.join("; ")}`);
  assert.match(r.text, /1A WS/);
  assert.match(r.text, /1B MCU kiran\n/, "unknown cast dropped from the outline");
  assert.ok(!/moonwalk/.test(r.text));
  const repair = s.calls.filter((c) => c.task === "shot")[1];
  assert.match(repair.prompt, /1B/);
  assert.ok(!/1A:\n/.test(repair.prompt.split("THESE SHOTS HAD ERRORS")[1] ?? ""), "only the broken shot is sent back");
});

import { gripFor, settingsFor } from "../src/llm/capability.ts";

test("hand-holding follows capability: strong models run free, weak ones get a tighter grip, pins win", () => {
  assert.equal(gripFor(GEMINI_MODELS.opus, "plan"), "free");
  assert.equal(gripFor(GEMINI_MODELS.sonnet, "patch"), "free");
  assert.equal(gripFor(GEMINI_MODELS.haiku, "read"), "free");
  assert.notEqual(gripFor(GEMINI_MODELS.haiku, "patch"), "free", "Flash-Lite never builds unaided");
  assert.notEqual(gripFor(GEMINI_MODELS.sonnet, "script"), "free", "Flash writes episodes shot by shot");
  assert.notEqual(gripFor("claude-opus-5-5", "prop3d"), "strict");
  assert.equal(settingsFor("some-tiny-model", "patch").grip, "strict");
  process.env.CREW_GRIP_PATCH = "strict";
  try { assert.equal(gripFor(GEMINI_MODELS.sonnet, "patch"), "strict"); } finally { delete process.env.CREW_GRIP_PATCH; }
});

test("a loose grip lets the model own the answer; code's moves only stand in when it has none", async () => {
  const s = scripted((c) => {
    if (c.task === "route") return route(["1A"], ["blocking"]);
    if (c.task === "plan") return { ...plan, shots: ["1A"], roles: ["blocking"] };
    if (c.task === "build") return takes(["kiran waits at the door", "1A.4 = kiran walk fridge 0.8"]);
    if (c.task === "review") return review();
  });
  const strong = { ...s.llm, modelFor: () => GEMINI_MODELS.sonnet };
  const n = await Crew.open(fresh(), { llm: strong }).note("1A kiran and mum bump into each other as he crosses the kitchen");
  assert.ok(n.takes.length >= 1);
  assert.ok(n.takes.every((t) => t.tier !== "code"), n.takes.map((t) => t.tier).join());
});
