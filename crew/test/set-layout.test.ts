import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Crew } from "../src/index.ts";
import { anchorsInUse, checkBlock, proposeSetLayout, replaceSetBlock, setBlock } from "../src/assets/set-layout.ts";
import type { LLM, LLMCall, LLMResult } from "../src/claude/llm.ts";

const fresh = () => { const d = mkdtempSync(join(tmpdir(), "crew-")); cpSync(join(import.meta.dirname, "..", "shows", "kitchen"), d, { recursive: true, filter: (s) => !s.includes(".crew") }); return d; };

test("the episode's anchors are found and must survive a new layout", () => {
  const p = Crew.open(fresh(), { llm: "offline" }).project;
  const keep = anchorsInUse(p, "kitchen");
  for (const a of ["door", "chair", "fridge", "counter"]) assert.ok(keep.includes(a), a);
  const block = setBlock(p.showSrc, "kitchen");
  assert.deepEqual(checkBlock(p.showSrc, "kitchen", block, keep), [], "today's set passes its own checks");
  const broken = block.replace(/\n\s+anchor fridge[^\n]*/, "").replace("anchor sink at 1.5 0.9", "anchor sink at 9 0.9");
  const problems = checkBlock(p.showSrc, "kitchen", broken, keep);
  assert.ok(problems.some((x) => /fridge/.test(x) && /Keep these anchors/.test(x)));
  assert.ok(problems.some((x) => /sink .* outside/.test(x)));
});

test("Pro's layout is checked and repaired from the pictures, and only written when accepted", async () => {
  const crew = Crew.open(fresh(), { llm: "offline" });
  const p = crew.project;
  const good = setBlock(p.showSrc, "kitchen").replace("dress", "dress").replace("set kitchen size 7 5.5", "set kitchen size 7.5 5.5") + "\n  dress potted_plant at 3.2 2.3";
  const calls: LLMCall[] = [];
  const llm: LLM = { mode: "gemini", async call<T>(c: LLMCall): Promise<LLMResult<T>> {
    calls.push(c);
    const text = calls.length === 1 ? "```\nset kitchen size 7 5.5 entrance door\n  anchor door at -3.1 0.9 face 90\n```" : good;
    return { ok: true, data: null, text, model: "fake", tier: c.tier, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, ms: 0 };
  } };
  const before = p.showSrc;
  const r = await proposeSetLayout(llm, p, { setId: "kitchen", images: [{ mimeType: "image/png", data: "aGk=" }] });
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.equal(r.attempts, 2);
  assert.equal(calls[0].images?.length, 1, "the pictures reach the model");
  assert.equal(calls[0].tier, "opus");
  assert.match(calls[1].prompt, /Keep these anchors/);
  assert.equal(p.showSrc, before, "nothing is written by the proposal");
  p.setShowSource(replaceSetBlock(p.showSrc, "kitchen", r.block));
  assert.match(p.showSrc, /potted_plant/);
  assert.deepEqual(p.show.errors, []);
});
