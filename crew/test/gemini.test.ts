import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GeminiClient, type GeminiRequest } from "../src/llm/gemini.ts";
import { extractJson, validateAndCoerce, schemaStats, type Schema } from "../src/llm/json.ts";
import { lowerForGemini, schemaAsPromptText, tooComplex } from "../src/llm/schema-lower.ts";
import { takesSchema } from "../src/crew/schema.ts";
import { parseShow } from "../src/scene/parse.ts";

const VERBS = ["walk", "run", "sit", "stand", "nod"];
const schema: Schema = {
  type: "object", additionalProperties: false, required: ["verb", "n", "note", "tags"],
  properties: {
    verb: { type: "string", enum: VERBS },
    n: { type: "number" },
    note: { anyOf: [{ type: "string" }, { type: "null" }] },
    tags: { type: "array", items: { type: "string" } },
    kind: { const: "action" },
  },
};

type Call = { url: string; headers: Record<string, string>; body: any };
function fake(replies: Array<{ status?: number; body: unknown } | Error>) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const fetchFn = (async (url: string, init: any) => {
    calls.push({ url: String(url), headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  const client = new GeminiClient({ apiKey: "k", fetch: fetchFn, sleep: async (ms) => { sleeps.push(ms); } });
  return { client, calls, sleeps };
}
const reply = (text: string, extra: Record<string, unknown> = {}, usage: Record<string, number> = {}) => ({
  body: { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP", ...extra }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 3, cachedContentTokenCount: 1, ...usage } },
});
const err = (status: number, message: string, details: unknown[] = []) => ({ status, body: { error: { code: status, message, status: "X", details } } });
const req = (o: Partial<GeminiRequest> = {}): GeminiRequest => ({ model: "gemini-3.8-flash", system: "SYS", prompt: "PROMPT", thinking: "high", ...o });
const good = JSON.stringify({ verb: "walk", n: 1, note: null, tags: [] });

test("request body shape", async () => {
  const { client, calls } = fake([reply(good)]);
  const r = await client.generate(req({ schema }));
  assert.equal(r.ok, true);
  assert.equal(r.schemaMode, "native");
  const c = calls[0];
  assert.equal(c.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(c.headers["x-goog-api-key"], "k");
  assert.deepEqual(c.body.systemInstruction, { parts: [{ text: "SYS" }] });
  assert.deepEqual(c.body.contents, [{ role: "user", parts: [{ text: "PROMPT" }] }]);
  const g = c.body.generationConfig;
  assert.equal(g.thinkingConfig.thinkingLevel, "HIGH");
  assert.equal(g.temperature, undefined);
  assert.equal(g.thinkingConfig.thinkingBudget, undefined);
  assert.equal(g.responseMimeType, "application/json");
  const s = JSON.stringify(g.responseJsonSchema);
  assert.ok(!s.includes("additionalProperties") && !s.includes('"const"'));
  assert.deepEqual(g.responseJsonSchema.properties.note.type, ["string", "null"]);
  assert.deepEqual(g.responseJsonSchema.properties.kind.enum, ["action"]);
  assert.deepEqual(r.usage, { input: 10, output: 5, thoughts: 3, cached: 1 });
});

test("no schema means plain text", async () => {
  const { client, calls } = fake([reply("hello")]);
  const r = await client.generate(req());
  assert.equal(r.text, "hello");
  assert.equal(r.schemaMode, "none");
  assert.equal(calls[0].body.generationConfig.responseMimeType, undefined);
});

test("thought parts are ignored", async () => {
  const { client } = fake([{ body: { candidates: [{ content: { parts: [{ text: "thinking out loud", thought: true }, { text: good }] }, finishReason: "STOP" }] } }]);
  const r = await client.generate(req({ schema }));
  assert.equal(r.ok, true);
  assert.equal(r.text, good);
});

test("fenced JSON with trailing comma is extracted", async () => {
  const { client } = fake([reply('Sure!\n```json\n{"verb": "walk", "n": 2, "note": null, "tags": [],}\n```\nHope that helps.')]);
  const r = await client.generate(req({ schema }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { verb: "walk", n: 2, note: null, tags: [] });
});

test("enum near-misses are coerced", async () => {
  const { client } = fake([reply(JSON.stringify({ verb: "Walk ", n: 1, note: null, tags: [] })), reply(JSON.stringify({ verb: "wlak", n: 1, note: null, tags: [] }))]);
  const a = await client.generate(req({ schema }));
  assert.equal((a.data as any).verb, "walk");
  assert.equal(a.ok, true);
  const b = await client.generate(req({ schema }));
  assert.equal((b.data as any).verb, "walk");
  assert.equal(b.coercions[0].why, "closest allowed value");
  assert.equal(b.coercions[0].path, "verb");
});

test("numeric strings, missing nullable and extra properties are coerced", async () => {
  const { client } = fake([reply(JSON.stringify({ verb: "run", n: "2.5", tags: "x", extra: 1 }))]);
  const r = await client.generate(req({ schema }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { verb: "run", n: 2.5, tags: ["x"], note: null });
  const whys = r.coercions.map((c) => c.why);
  assert.ok(whys.includes("numeric string") && whys.includes("missing nullable field") && whys.some((w) => /extra property/.test(w)));
});

test("a wrong enum value lists the allowed values", async () => {
  const { client } = fake([reply(JSON.stringify({ verb: "moonwalk", n: 1, note: null, tags: [] }))]);
  const r = await client.generate(req({ schema }));
  assert.equal(r.ok, false);
  assert.equal(r.errorKind, "format");
  assert.match(r.formatErrors[0], /^verb: "moonwalk" is not allowed; allowed: walk, run, sit, stand, nod$/);
  assert.deepEqual((r.data as any).verb, "moonwalk");
});

test("429 with RetryInfo waits the delay, then succeeds", async () => {
  const { client, sleeps, calls } = fake([err(429, "slow down", [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "12s" }]), reply(good)]);
  const r = await client.generate(req({ schema }));
  assert.equal(r.ok, true);
  assert.deepEqual(sleeps, [12000]);
  assert.equal(r.attempts, 2);
  assert.equal(calls.length, 2);
});

test("429 daily quota is final", async () => {
  const { client, calls } = fake([err(429, "You exceeded your quota: requests per day limit")]);
  const r = await client.generate(req({ schema }));
  assert.equal(r.errorKind, "quota");
  assert.equal(calls.length, 1);
});

test("503 twice then success", async () => {
  const { client, sleeps } = fake([err(503, "overloaded"), err(503, "overloaded"), reply(good)]);
  const r = await client.generate(req({ schema }));
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 3);
  assert.equal(sleeps.length, 2);
});

test("server errors give up after maxRetries", async () => {
  const { client, calls } = fake([err(500, "boom")]);
  const r = await client.generate(req());
  assert.equal(r.errorKind, "server");
  assert.equal(calls.length, 5);
});

test("network errors retry", async () => {
  const { client } = fake([new Error("ECONNRESET"), reply("ok")]);
  const r = await client.generate(req());
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
});

test("401 is auth, 404 is not_found, neither retries", async () => {
  const a = fake([err(401, "API key not valid")]);
  const ra = await a.client.generate(req());
  assert.equal(ra.errorKind, "auth");
  assert.equal(a.calls.length, 1);
  const b = fake([err(404, "models/x is not found")]);
  const rb = await b.client.generate(req({ model: "models/x" }));
  assert.equal(rb.errorKind, "not_found");
  assert.match(rb.error!, /model id/);
  assert.equal(b.calls.length, 1);
  assert.match(b.calls[0].url, /\/models\/x:generateContent$/);
});

test("schema 400 retries in prompt mode with the shape in the prompt", async () => {
  const { client, calls } = fake([err(400, "The specified schema produces a constraint that has too many states for serving."), reply(good)]);
  const r = await client.generate(req({ schema }));
  assert.equal(r.ok, true);
  assert.equal(r.schemaMode, "prompt");
  const g = calls[1].body.generationConfig;
  assert.equal(g.responseJsonSchema, undefined);
  assert.equal(g.responseMimeType, "application/json");
  const text = calls[1].body.contents[0].parts[0].text as string;
  assert.ok(text.startsWith("PROMPT\n\nReply with only JSON matching this shape:\n"));
  assert.match(text, /"verb": "walk" \| "run" \| "sit" \| "stand" \| "nod"/);
});

test("mime type rejection falls back to plain text", async () => {
  const { client, calls } = fake([err(400, "bad schema"), err(400, "response_mime_type is not supported"), reply('{"verb":"sit","n":1,"note":null,"tags":[]}')]);
  const r = await client.generate(req({ schema }));
  assert.equal(r.ok, true);
  assert.equal(r.schemaMode, "none");
  assert.equal(calls[2].body.generationConfig.responseMimeType, undefined);
});

test("a too-complex schema goes straight to prompt mode", async () => {
  const big: Schema = { type: "object", required: ["v"], properties: { v: { type: "string", enum: Array.from({ length: 500 }, (_, i) => `w${i}`) } } };
  const { client, calls } = fake([reply('{"v":"w3"}')]);
  const r = await client.generate(req({ schema: big }));
  assert.equal(r.schemaMode, "prompt");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.generationConfig.responseJsonSchema, undefined);
  assert.equal(r.ok, true);
});

test("MAX_TOKENS keeps the partial text", async () => {
  const { client } = fake([reply('{"verb": "wa', { finishReason: "MAX_TOKENS" })]);
  const r = await client.generate(req({ schema }));
  assert.equal(r.errorKind, "max_tokens");
  assert.equal(r.text, '{"verb": "wa');
  assert.equal(r.ok, false);
});

test("SAFETY and prompt blocks are blocked", async () => {
  const a = fake([reply("", { finishReason: "SAFETY" })]);
  assert.equal((await a.client.generate(req())).errorKind, "blocked");
  const b = fake([{ body: { promptFeedback: { blockReason: "PROHIBITED_CONTENT" } } }]);
  const rb = await b.client.generate(req());
  assert.equal(rb.errorKind, "blocked");
  assert.match(rb.error!, /PROHIBITED_CONTENT/);
});

test("empty text retries once, then reports empty", async () => {
  const { client, calls } = fake([reply("")]);
  const r = await client.generate(req());
  assert.equal(r.errorKind, "empty");
  assert.equal(calls.length, 2);
});

test("unparseable reply is a format error with a clear message", async () => {
  const { client } = fake([reply('{"verb": "walk", "n": 1, "tags": [')]);
  const r = await client.generate(req({ schema }));
  assert.equal(r.errorKind, "format");
  assert.match(r.error!, /cut off/);
  assert.equal(r.data, null);
});

test("thinking level casing falls back to lowercase and is remembered", async () => {
  const { client, calls } = fake([err(400, "Invalid value at 'generation_config.thinking_config.thinking_level'"), reply("ok"), reply("ok")]);
  const r = await client.generate(req());
  assert.equal(r.ok, true);
  assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingLevel, "HIGH");
  assert.equal(calls[1].body.generationConfig.thinkingConfig.thinkingLevel, "high");
  await client.generate(req());
  assert.equal(calls[2].body.generationConfig.thinkingConfig.thinkingLevel, "high");
});

test("unsupported thinking level moves up one and is reported", async () => {
  const { client, calls } = fake([err(400, "Thinking level MINIMAL is not supported for this model"), reply("ok")]);
  const r = await client.generate(req({ thinking: "minimal" }));
  assert.equal(r.ok, true);
  assert.equal(calls[1].body.generationConfig.thinkingConfig.thinkingLevel, "LOW");
  assert.deepEqual(r.coercions[0], { path: "thinking", from: "minimal", to: "low", why: "this model does not support the requested thinking level" });
});

test("listModels pages and filters", async () => {
  const { client, calls } = fake([
    { body: { models: [{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/embed", supportedGenerationMethods: ["embedContent"] }], nextPageToken: "T2" } },
    { body: { models: [{ name: "models/gemini-3.1-pro", supportedGenerationMethods: ["generateContent", "countTokens"] }] } },
  ]);
  assert.deepEqual(await client.listModels(), ["gemini-3.8-flash", "gemini-3.1-pro"]);
  assert.match(calls[0].url, /\/v1beta\/models\?pageSize=1000$/);
  assert.match(calls[1].url, /pageToken=T2$/);
});

test("kitchen show schemas: stats and lowering", () => {
  const show = parseShow(readFileSync(join(import.meta.dirname, "..", "shows", "kitchen", "show.scene"), "utf8"));
  for (const role of ["director", "writer", "blocking", "dp", "animator", "editor", "sound"] as const) {
    const s = takesSchema(show, role);
    const low = lowerForGemini(s);
    const j = JSON.stringify(low);
    assert.ok(!j.includes('"const"') && !j.includes("additionalProperties"), role);
    console.log(role, JSON.stringify(schemaStats(low)), "tooComplex:", tooComplex(s));
    assert.ok(schemaAsPromptText(s).length > 100);
  }
});

test("lowerForGemini is pure and handles const, nullable and non-string enums", () => {
  const s: Schema = { type: "object", additionalProperties: false, title: "T", properties: { a: { const: 3 }, b: { anyOf: [{ type: "integer", enum: [1, 2] }, { type: "null" }], description: "d" }, c: { anyOf: [{ type: "string" }, { type: "number" }] } } };
  const copy = JSON.stringify(s);
  const l = lowerForGemini(s) as any;
  assert.equal(JSON.stringify(s), copy);
  assert.deepEqual(l.properties.a, { type: "string", enum: ["3"] });
  assert.deepEqual(l.properties.b, { type: ["string", "null"], enum: ["1", "2"], description: "d" });
  assert.equal(l.properties.c.anyOf.length, 2);
  assert.equal(l.title, undefined);
  assert.equal(l.additionalProperties, undefined);
});

// ---------------------------------------------------------------- json.ts

test("extractJson: truncation, smart quotes, prose, arrays, BOM, NaN", () => {
  const cut = extractJson('Here: {"a": [1, 2, {"b": 3}');
  assert.ok(!cut.ok && /the reply was cut off/.test(cut.error));
  const sm = extractJson("{“a”: “hello”}");
  assert.ok(sm.ok && JSON.stringify(sm.value) === '{"a":"hello"}' && sm.repaired.includes("smart quotes"));
  const prose = extractJson('Result {not json} then [1, 2, 3] and {"later": 1}');
  assert.ok(prose.ok && JSON.stringify(prose.value) === "[1,2,3]");
  const arr = extractJson('```json\n[{"a":1},{"a":2},]\n```');
  assert.ok(arr.ok && (arr.value as any[]).length === 2 && arr.repaired.includes("removed trailing comma"));
  const nan = extractJson('﻿{"a": NaN, "b": undefined, "c": 1}');
  assert.ok(nan.ok && JSON.stringify(nan.value) === '{"a":null,"b":null,"c":1}' && nan.repaired.includes("removed BOM"));
  const single = extractJson("{'a': 'it\\'s', b: 'don't'}");
  assert.ok(single.ok && (single.value as any).a === "it's" && (single.value as any).b === "don't");
  const first = extractJson('{"a":1} {"b":2}');
  assert.ok(first.ok && JSON.stringify(first.value) === '{"a":1}');
  assert.ok(!extractJson("no json here").ok);
  assert.ok(!extractJson("   ").ok);
});

test("extractJson: strings containing braces and unescaped quotes", () => {
  const r = extractJson('{"text": "a } b { c", "q": "he said "hi" ok"}');
  assert.ok(r.ok);
  assert.equal((r.value as any).text, "a } b { c");
  assert.equal((r.value as any).q, 'he said "hi" ok');
});

test("extractJson: a cut-off outer value is not mistaken for its inner object", () => {
  const r = extractJson('{"takes": [{"a": 1}, {"b": ');
  assert.ok(!r.ok && /cut off/.test(r.error));
});

test("anyOf chooses the branch by kind and reports its errors", () => {
  const a = { type: "object", required: ["kind", "x"], additionalProperties: false, properties: { kind: { const: "a" }, x: { type: "integer" } } };
  const b = { type: "object", required: ["kind", "y"], additionalProperties: false, properties: { kind: { const: "b" }, y: { type: "string", enum: ["p", "q"] } } };
  const s: Schema = { type: "object", required: ["line"], properties: { line: { anyOf: [a, b, { type: "null" }] } } };
  const r = validateAndCoerce(s, { line: { kind: "b", y: "r" } });
  assert.deepEqual(r.errors, ['line.y: "r" is not allowed; allowed: p, q']);
  assert.deepEqual(validateAndCoerce(s, { line: { kind: "a", x: "3.0" } }).value, { line: { kind: "a", x: 3 } });
  const k = validateAndCoerce(s, { line: { kind: "z" } });
  assert.match(k.errors[0], /^line\.kind: "z" is not allowed; allowed: a, b$/);
  assert.deepEqual(validateAndCoerce(s, { line: "none" }).value, { line: null });
  assert.deepEqual(validateAndCoerce(s, { line: null }).coercions, []);
});

test("enum 'none' stays a valid value; near-miss only when unique; allowed list is capped", () => {
  const s: Schema = { anyOf: [{ type: "string", enum: ["nod", "stay"] }, { type: "null" }] };
  assert.equal(validateAndCoerce(s, "none").value, null);
  const e: Schema = { type: "string", enum: ["abcd", "abce"] };
  assert.equal(validateAndCoerce(e, "abcx").errors.length, 1);
  assert.equal(validateAndCoerce({ type: "string", enum: ["sit down", "stand"] }, "SIT_DOWN").value, "sit down");
  const many: Schema = { type: "string", enum: Array.from({ length: 40 }, (_, i) => `value${i * 7}zz`) };
  assert.match(validateAndCoerce(many, "qqqqqqqq").errors[0], /and 15 more$/);
});

test("integer, boolean and required errors have paths", () => {
  const s: Schema = { type: "object", required: ["a", "b"], properties: { a: { type: "integer" }, b: { type: "array", items: { type: "object", required: ["c"], properties: { c: { type: "boolean" } } } } } };
  const r = validateAndCoerce(s, { a: 2.5, b: [{ c: "true" }, {}] });
  assert.deepEqual(r.errors, ["a: expected integer, got number", "b[1].c: required property is missing"]);
  assert.equal(validateAndCoerce(s, { a: 2.0, b: [{ c: true }] }).errors.length, 0);
  assert.equal(schemaStats(s).depth, 3);
});
