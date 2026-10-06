import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectKey, keyLooksRight, saveKey, sameOrigin } from "../src/claude/setup.ts";
import { Crew } from "../src/index.ts";
import { startServer } from "../src/server.ts";

const KEY = "sk-ant-api03-" + "x".repeat(40);

test("key shape", () => {
  assert.ok(keyLooksRight(KEY));
  assert.ok(keyLooksRight(`  ${KEY}\n`));
  assert.ok(!keyLooksRight("sk-123"));
  assert.ok(!keyLooksRight(""));
});

test("saveKey adds or replaces one line and keeps the rest, private to the owner", () => {
  const f = join(mkdtempSync(join(tmpdir(), "env-")), ".env");
  writeFileSync(f, "PORT=4310\nCREW_LLM=auto\n");
  saveKey(f, KEY);
  assert.equal(readFileSync(f, "utf8"), `PORT=4310\nCREW_LLM=auto\nANTHROPIC_API_KEY=${KEY}\n`);
  saveKey(f, KEY + "y");
  assert.equal(readFileSync(f, "utf8"), `PORT=4310\nCREW_LLM=auto\nANTHROPIC_API_KEY=${KEY}y\n`);
  assert.equal(statSync(f).mode & 0o077, 0, "no group or world access");
});

test("only the Crew page may post a key", () => {
  assert.ok(sameOrigin("localhost:4310", "http://localhost:4310", "application/json"));
  assert.ok(sameOrigin("127.0.0.1:4310", undefined, "application/json; charset=utf-8"));
  assert.ok(!sameOrigin("evil.example", undefined, "application/json"));
  assert.ok(!sameOrigin("localhost:4310", "https://evil.example", "application/json"));
  assert.ok(!sameOrigin("localhost:4310", undefined, "text/plain"));
});

test("connectKey checks before it saves, and applies only a good key", async () => {
  const f = join(mkdtempSync(join(tmpdir(), "env-")), ".env");
  let applied = "";
  const bad = await connectKey({ key: KEY, envPath: f, check: async () => ({ ok: false, error: "refused" }), apply: (k) => (applied = k) });
  assert.deepEqual(bad, { ok: false, error: "refused" });
  assert.equal(applied, "");
  assert.throws(() => readFileSync(f), "nothing written for a bad key");
  assert.equal((await connectKey({ key: "nope", envPath: f, apply: () => {} })).ok, false);
  const good = await connectKey({ key: KEY, envPath: f, check: async () => ({ ok: true }), apply: (k) => (applied = k) });
  assert.equal(good.ok, true);
  assert.equal(applied, KEY);
  assert.match(readFileSync(f, "utf8"), /ANTHROPIC_API_KEY=sk-ant-/);
});

test("POST /api/key refuses other origins and malformed keys without touching .env", async () => {
  const d = mkdtempSync(join(tmpdir(), "crew-"));
  cpSync(join(import.meta.dirname, "..", "shows", "kitchen"), d, { recursive: true, filter: (s) => !s.includes(".crew") });
  const crew = Crew.open(d, { llm: "offline" });
  const { url, close } = await startServer(crew, 4392);
  try {
    const post = (headers: Record<string, string>, body: unknown) => fetch(`${url}/api/key`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    assert.equal((await post({ origin: "https://evil.example" }, { key: KEY })).status, 403);
    assert.equal((await post({}, { key: "nope" })).status, 400);
    const st = await (await fetch(`${url}/api/state`)).json();
    assert.equal(typeof st.hasKey, "boolean");
    assert.equal(crew.llm.mode, "offline");
  } finally { close(); }
});
