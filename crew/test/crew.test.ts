import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Crew, ClaudeLLM, parseEpisode, parseShow, printDoc } from "../src/index.ts";
import { workspace } from "../src/crew/guard.ts";
import { parsePatch, applyPatch, checkPermission } from "../src/scene/patch.ts";
import { takesSchema } from "../src/crew/schema.ts";
import { startServer } from "../src/server.ts";
import type { ClientLike } from "../src/claude/llm.ts";

const SHOW = join(import.meta.dirname, "..", "shows", "kitchen");
const fresh = () => { const d = mkdtempSync(join(tmpdir(), "crew-")); cpSync(SHOW, d, { recursive: true, filter: (s) => !s.includes(".crew") }); return d; };
const show = parseShow(readFileSync(join(SHOW, "show.scene"), "utf8"));
const src = readFileSync(join(SHOW, "ep01.scene"), "utf8");

test("show bible parses cleanly, with character models", () => {
  assert.deepEqual(show.errors, []);
  assert.equal(show.cast.mum.model, "female");
});

test("episode round-trips byte for byte", () => {
  assert.equal(printDoc(parseEpisode(src)), src.endsWith("\n") ? src : src + "\n");
});

test("unknown words are rejected before render", () => {
  const ws = workspace(show, parseEpisode(src.replace("kiran nod", "kiran moonwalk")));
  assert.ok(ws.grammar.some((g) => /unknown verb "moonwalk"/.test(g.message)));
});

test("token edit patch changes one line", () => {
  const doc = parseEpisode(src);
  const r = applyPatch(doc, parsePatch("1D.2 ~2.5 -> ~1.5"));
  assert.equal(r.changes.length, 1);
  assert.match(r.changes[0].after!, /kiran shock ~1.5/);
});

test("permissions: the DP cannot touch blocking", () => {
  const p = checkPermission("dp", parsePatch("1A.4 = kiran walk counter"), parseEpisode(src));
  assert.ok(p.length > 0);
});

test("locality guard rejects continuity spill and explains it", () => {
  const ws = workspace(show, parseEpisode(src));
  const crew = Crew.open(fresh(), { llm: "offline" });
  const r = crew.patch("1A.4 kiran walk fridge 1.0 -> kiran walk counter 1.0", { role: "blocking", dryRun: true });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /locality: 1B/.test(x)));
  void ws;
});

test("QC catches the demo's clip and furniture collision", () => {
  const ws = workspace(show, parseEpisode(src));
  assert.ok(ws.qc.issues.some((i) => i.check === "intersection" && i.shot === "1A"));
  assert.ok(ws.qc.issues.some((i) => i.check === "furniture" && i.shot === "1A"));
});

test("offline crew: a note becomes a local take that fixes it, and undo restores", async () => {
  const crew = Crew.open(fresh(), { llm: "offline" });
  const before = crew.source;
  const n = await crew.note("1A 0:02, kiran clips mum");
  assert.equal(n.status, "open");
  assert.ok(n.takes.length >= 1);
  assert.deepEqual(n.takes[0].changedShots, ["1A"]);
  assert.ok(n.takes[0].fixed.length >= 1);
  crew.accept(n.id, n.takes[0].id);
  assert.ok(!crew.qc.issues.some((i) => i.check === "intersection"));
  assert.equal(crew.project.metrics().resolvedFirstRound, 1);
  crew.undo();
  assert.equal(crew.source, before);
});

test("notes without a shot ask for one", async () => {
  const crew = Crew.open(fresh(), { llm: "offline" });
  const n = await crew.note("make it better");
  assert.equal(n.status, "needs-shot");
});

test("Claude client: structured output, cached prefix, fallbacks, effort only above Haiku", async () => {
  const calls: { beta: boolean; p: Record<string, unknown> }[] = [];
  const reply = (p: Record<string, unknown>) => ({ model: p.model, stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }, content: [{ type: "text", text: JSON.stringify({ takes: [], pushback: null, idea: null }) }] });
  const client = {
    messages: { create: async (p: Record<string, unknown>) => { calls.push({ beta: false, p }); return reply(p); } },
    beta: { messages: { create: async (p: Record<string, unknown>) => { calls.push({ beta: true, p }); return reply(p); } } },
  } as unknown as ClientLike;
  const llm = new ClaudeLLM({ client });
  const schema = takesSchema(show, "dp");
  const s = await llm.call({ task: "propose", role: "dp", tier: "sonnet", system: ["a", "b"], prompt: "x", schema, effort: "medium" });
  const h = await llm.call({ task: "propose", role: "dp", tier: "haiku", system: ["a", "b"], prompt: "x", schema, effort: "medium" });
  assert.ok(s.ok && h.ok);
  const [sc, hc] = calls;
  assert.equal(sc.beta, true);
  assert.equal(sc.p.fallbacks, "default");
  assert.deepEqual((sc.p.output_config as { effort: string }).effort, "medium");
  assert.equal(hc.beta, false);
  assert.equal((hc.p.output_config as { effort?: string }).effort, undefined);
  const sys = sc.p.system as { cache_control?: unknown }[];
  assert.ok(sys[1].cache_control && !sys[0].cache_control);
  assert.ok(s.cost > 0);
});

test("server: state, assets and a note over HTTP", async () => {
  const crew = Crew.open(fresh(), { llm: "offline" });
  const srv = await startServer(crew, 4391);
  try {
    const st = await (await fetch(`${srv.url}/api/state`)).json();
    assert.equal(st.baked.shots.length, 7);
    assert.ok(st.baked.sets.kitchen.boxes.length > 0);
    const glb = await fetch(`${srv.url}${st.assets.characters.female}`);
    assert.equal(glb.headers.get("content-type"), "model/gltf-binary");
    assert.ok((await fetch(`${srv.url}/vendor/three/addons/loaders/GLTFLoader.js`)).ok);
    const n = await (await fetch(`${srv.url}/api/note`, { method: "POST", body: JSON.stringify({ note: "1D is too long" }) })).json();
    assert.ok(n.takes.length >= 1);
    const pv = await fetch(`${srv.url}/api/preview?note=${n.id}&take=${n.takes[0].id}`);
    assert.ok(pv.ok);
    assert.equal((await fetch(`${srv.url}/../../etc/passwd`)).status, 404);
  } finally { srv.close(); }
});
