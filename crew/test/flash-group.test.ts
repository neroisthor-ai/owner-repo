import { test } from "node:test";
import assert from "node:assert/strict";
import { GeminiLLM, GEMINI_MODELS } from "../src/llm/gemini-llm.ts";
import type { GeminiClient, GeminiRequest, GeminiResponse } from "../src/llm/gemini.ts";

const reply = (r: GeminiRequest, over: Partial<GeminiResponse>): GeminiResponse => ({
  ok: true, text: "", data: null, formatErrors: [], coercions: [], usage: { input: 10, output: 5, thoughts: 0, cached: 0 },
  model: r.model, ms: 1, attempts: 1, schemaMode: r.schema ? "native" : "none", ...over,
});
const fake = (answer: (r: GeminiRequest, n: number) => Partial<GeminiResponse>) => {
  const seen: GeminiRequest[] = [];
  const client = { generate: async (r: GeminiRequest) => { seen.push(r); return reply(r, answer(r, seen.length)); } } as unknown as GeminiClient;
  return { client, seen };
};
const schema = { type: "object", properties: { shot: { type: "string" } }, required: ["shot"] };
const call = { task: "plan" as const, role: "director", tier: "opus" as const, system: ["s"], prompt: "Which shot?", schema };

test("flash mode: Pro's job goes to a group of Flash calls on high thinking with the most output room, then a final pass", async () => {
  const { client, seen } = fake((r) => ({ data: { shot: /colleagues/.test(r.prompt) ? "1D" : seen.length % 2 ? "1D" : "2A" } }));
  const llm = new GeminiLLM({ client, proMode: "flash", groupSize: 3 });
  const r = await llm.call<{ shot: string }>(call);
  assert.equal(r.ok, true);
  assert.equal(r.data?.shot, "1D");
  assert.equal(seen.length, 4);
  assert.ok(seen.every((q) => q.model === GEMINI_MODELS.sonnet && q.thinking === "high" && q.maxOutputTokens === 65536));
  assert.match(seen[3].prompt, /ANSWER 1[\s\S]*ANSWER 3/);
  assert.equal(llm.modelFor("opus"), GEMINI_MODELS.sonnet);
});

test("flash group: when every answer agrees there is no final pass", async () => {
  const { client, seen } = fake(() => ({ data: { shot: "1D" } }));
  const r = await new GeminiLLM({ client, proMode: "flash", groupSize: 3 }).call<{ shot: string }>(call);
  assert.equal(r.data?.shot, "1D");
  assert.equal(seen.length, 3);
});

test("flash group: a failed final pass falls back to a good answer; all failing returns the error", async () => {
  let { client } = fake((r, n) => (/colleagues/.test(r.prompt) ? { ok: false, errorKind: "server", error: "boom" } : { data: { shot: n === 1 ? "1D" : "2A" } }));
  let r = await new GeminiLLM({ client, proMode: "flash", groupSize: 2 }).call<{ shot: string }>(call);
  assert.equal(r.ok, true);
  ({ client } = fake(() => ({ ok: false, errorKind: "server", error: "boom" })));
  r = await new GeminiLLM({ client, proMode: "flash", groupSize: 2 }).call<{ shot: string }>(call);
  assert.equal(r.ok, false);
});

test("auto mode: Pro with limit 0 switches to the Flash group for good", async () => {
  const { client, seen } = fake((r) => (r.model === GEMINI_MODELS.opus ? { ok: false, errorKind: "quota", error: "not available on this key's tier (limit 0)" } : { data: { shot: "1D" } }));
  const llm = new GeminiLLM({ client, proMode: "auto", groupSize: 2 });
  assert.equal(llm.modelFor("opus"), GEMINI_MODELS.opus);
  assert.equal((await llm.call<{ shot: string }>(call)).data?.shot, "1D");
  assert.equal(llm.standIn, true);
  const before = seen.length;
  await llm.call(call);
  assert.ok(seen.slice(before).every((q) => q.model === GEMINI_MODELS.sonnet));
});

test("other tiers are untouched by the stand-in", async () => {
  const { client, seen } = fake(() => ({ data: { shot: "1D" } }));
  await new GeminiLLM({ client, proMode: "flash" }).call({ ...call, tier: "haiku" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].model, GEMINI_MODELS.haiku);
  assert.equal(seen[0].thinking, "low");
});

test("ladder: Flash out of quota steps down to the next model and rests the first until Google's reset time", async () => {
  let t = 0;
  const { client, seen } = fake((r) => (r.model === "f38" ? { ok: false, errorKind: "quota", error: "daily quota exhausted: limit: 20 ... Please retry in 2h30m0s." } : { data: { shot: r.model } }));
  const llm = new GeminiLLM({ client, ladders: { sonnet: ["f38", "f37", "f36"] }, now: () => t });
  const sonnet = { ...call, tier: "sonnet" as const };
  assert.equal((await llm.call<{ shot: string }>(sonnet)).data?.shot, "f37");
  assert.deepEqual(seen.map((q) => q.model), ["f38", "f37"]);
  assert.equal(llm.modelFor("sonnet"), "f37");
  await llm.call(sonnet);
  assert.equal(seen.at(-1)?.model, "f37");
  assert.equal(seen.length, 3);
  t = 2.5 * 3600e3 + 1;
  assert.equal(llm.modelFor("sonnet"), "f38");
});

test("ladder: overloaded models step down too; a bad request does not", async () => {
  const { client, seen } = fake((r) => (r.model === "f38" ? { ok: false, errorKind: "server", error: "503 high demand" } : r.model === "f37" ? { ok: false, errorKind: "bad_request", error: "bad" } : { data: { shot: "x" } }));
  const r = await new GeminiLLM({ client, ladders: { sonnet: ["f38", "f37", "f36"] } }).call({ ...call, tier: "sonnet" });
  assert.equal(r.ok, false);
  assert.deepEqual(seen.map((q) => q.model), ["f38", "f37"]);
});

test("ladder: the Flash group standing in for Pro climbs the Flash ladder", async () => {
  const { client, seen } = fake((r) => (r.model === "f38" ? { ok: false, errorKind: "quota", error: "limit: 20" } : { data: { shot: "1D" } }));
  const r = await new GeminiLLM({ client, proMode: "flash", groupSize: 2, ladders: { sonnet: ["f38", "f37"] } }).call<{ shot: string }>(call);
  assert.equal(r.data?.shot, "1D");
  assert.ok(seen.some((q) => q.model === "f37"));
});

test("retryInMs reads Google's wait", async () => {
  const { retryInMs } = await import("../src/llm/gemini-llm.ts");
  assert.equal(retryInMs("Please retry in 5h8m34.08s."), (5 * 3600 + 8 * 60 + 34.08) * 1000);
  assert.equal(retryInMs("Please retry in 40s"), 40000);
  assert.equal(retryInMs("nothing"), undefined);
});
