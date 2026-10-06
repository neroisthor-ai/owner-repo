import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LLM, LLMCall, LLMResult } from "../src/claude/llm.ts";
import { extractCode, runBuilder } from "../src/assets/sandbox.ts";
import { checkProp } from "../src/assets/checks.ts";
import { makeProp, type PropEvent } from "../src/assets/props.ts";
import { idProblem, listGenerated, loadGeneratedMeta, saveProp } from "../src/assets/store.ts";
import { BASE_META, PROP_META } from "../library/props/meta.js";

const reply = (f: string) => readFileSync(new URL(`../pro-exam/${f}`, import.meta.url), "utf8");
const KETTLE = reply("prop-kettle.reply.txt");
const KETTLE_INSIDE_OUT = reply("prop-kettle.flash.reply.txt");
const SIZE: [number, number, number] = [0.26, 0.24, 0.19];
const KETTLE_REQ = { id: "stovetop_kettle", description: "a stovetop kettle", size: SIZE, placement: "onSurface" };

type Out = string | object;
class Fake implements LLM {
  readonly mode = "offline" as const;
  calls: LLMCall[] = [];
  constructor(private f: (c: LLMCall, n: number) => Out) {}
  async call<T>(c: LLMCall): Promise<LLMResult<T>> {
    this.calls.push(c);
    const r = this.f(c, this.calls.length);
    const base = { model: "fake", tier: c.tier, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, ms: 0 };
    return typeof r === "string" ? { ...base, ok: true, data: null, text: r } : { ...base, ok: true, data: r as T, text: JSON.stringify(r) };
  }
}
/** builder replies in order (by call to a non-review, non-plan task), reviews pass */
const builders = (...codes: string[]) => { let i = 0; return new Fake((c) => c.task === "review" ? { ok: true, fixes: [] } : codes[Math.min(i++, codes.length - 1)]); };
const tmp = () => mkdtempSync(join(tmpdir(), "props-"));
const widget = (w: number, id = "widget") => `\`\`\`js\nexport function ${id}() {\n  const g = new THREE.Group();\n  box(g, ${w}, 0.24, 0.19, mat("#b83a2e"), 0, 0, 0);\n  return finish(g, "${id}", {});\n}\n\`\`\``;

test("makeProp: a correct kettle passes and is stored with measured meta", async () => {
  const dir = tmp();
  try {
    const events: PropEvent[] = [];
    const llm = builders(KETTLE);
    const r = await makeProp(llm, KETTLE_REQ, { dir, emit: (e) => events.push(e), modelFor: () => "test-model" });
    assert.equal(r.ok, true, String(r.error));
    assert.equal(r.attempts, 1);
    assert.ok(r.checks.every((c) => c.pass));
    assert.deepEqual(llm.calls.map((c) => c.tier), ["sonnet", "opus"]); // no spec call: the request had a size
    assert.match(llm.calls[0].prompt, /26 cm wide/);
    assert.deepEqual(listGenerated(dir), ["stovetop_kettle"]);
    const meta = loadGeneratedMeta(dir).stovetop_kettle;
    assert.equal(meta.placement, "onSurface");
    assert.equal(meta.source.by, "test-model");
    assert.equal(meta.source.description, "a stovetop kettle");
    assert.ok(Math.abs(meta.size[0] - 0.28) < 0.02 && meta.y0 === 0);
    const js = readFileSync(join(dir, "stovetop_kettle.js"), "utf8");
    assert.match(js, /from "\.\.\/core\.js"/);
    assert.match(js, /export \{ stovetop_kettle \}/);
    assert.equal(runBuilder(js, "stovetop_kettle").ok, true); // the stored module still runs
    assert.match(readFileSync(join(dir, "index.js"), "utf8"), /import \{ stovetop_kettle \} from "\.\/stovetop_kettle\.js"/);
    assert.match(readFileSync(join(dir, "meta.js"), "utf8"), /"module": "generated"/);
    assert.ok(events.some((e) => e.step === "saved"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("checks: the inside-out lid is caught and named; the repair prompt carries it", async () => {
  const r0 = runBuilder(extractCode(KETTLE_INSIDE_OUT), "stovetop_kettle");
  assert.ok(r0.ok);
  if (r0.ok) {
    const c = checkProp(r0.group, { id: "stovetop_kettle", size: SIZE });
    assert.equal(c.pass, false);
    assert.match(c.failures.join("\n"), /mesh 3 \(colour #b83a2e.*faces point inward \(inside out\): reverse the point order or use side: THREE\.DoubleSide/);
  }
  const dir = tmp();
  try {
    const llm = builders(KETTLE_INSIDE_OUT, KETTLE);
    const r = await makeProp(llm, KETTLE_REQ, { dir });
    assert.equal(r.ok, true, String(r.error));
    assert.equal(r.attempts, 2);
    assert.equal(llm.calls[1].task, "repair");
    assert.match(llm.calls[1].prompt, /inside out/);
    assert.match(llm.calls[1].prompt, /mesh 3/);
    assert.match(llm.calls[1].prompt, /createLatheGeometry|LatheGeometry/); // the code comes back too
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("checks: double-sided and mirrored meshes are not flagged, a reversed box is", () => {
  const flipped = `function f(){ const g = new THREE.Group(); const geo = new THREE.BoxGeometry(0.1,0.1,0.1); geo.scale(-1,1,1); mesh(geo, mat("#112233"), g, 0, 0.05, 0); return finish(g,"f",{}); }`;
  const dbl = flipped.replace('mat("#112233")', 'mat("#112233", { side: THREE.DoubleSide })');
  const mirrored = `function f(){ const g = new THREE.Group(); const m = mesh(new THREE.BoxGeometry(0.1,0.1,0.1), mat("#112233"), g, 0, 0.05, 0); m.scale.x = -1; return finish(g,"f",{}); }`;
  const run = (code: string) => { const r = runBuilder(code, "f"); assert.ok(r.ok); return r.ok ? checkProp(r.group, { id: "f" }).checks.find((c) => c.name === "no inside-out surfaces")!.pass : null; };
  assert.equal(run(flipped), false);
  assert.equal(run(dbl), true);
  assert.equal(run(mirrored), true);
});

test("checks: floating parts and ungrounded props are reported", () => {
  const code = `function f(){ const g = new THREE.Group(); box(g, 0.1, 0.1, 0.1, mat("#aa0000"), -0.1, 0.05, 0); box(g, 0.05, 0.05, 0.05, mat("#00aa00"), 0.1, 0.3, 0); return finish(g,"f",{}); }`;
  const r = runBuilder(code, "f");
  assert.ok(r.ok);
  if (r.ok) {
    const c = checkProp(r.group, { id: "f" });
    assert.match(c.failures.join("\n"), /no floating parts: mesh 0 \(colour #aa0000\)/);
    assert.match(c.failures.join("\n"), /stands on y=0/);
  }
});

test("makeProp: a builder that throws gets the error back", async () => {
  const dir = tmp();
  try {
    const llm = builders("```js\nexport function widget() { throw new Error(\"boom: no spout\"); }\n```", widget(0.26));
    const r = await makeProp(llm, { id: "widget", description: "a widget", size: SIZE }, { dir });
    assert.equal(r.ok, true, String(r.error));
    assert.equal(r.attempts, 2);
    assert.match(llm.calls[1].prompt, /boom: no spout/);
    assert.match(llm.calls[1].prompt, /did not run/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("sandbox: require, process, timers and escapes fail safely", async () => {
  for (const body of ['require("fs").readFileSync("/etc/passwd")', "process.exit(1)", "fetch('http://x')", "setTimeout(()=>{},1)", "this.constructor.constructor('return process')()"]) {
    const r = runBuilder(`function f(){ ${body}; return new THREE.Group(); }`, "f");
    assert.equal(r.ok, false, body);
  }
  const r = runBuilder(`function f(){ while(true){} }`, "f");
  assert.ok(!r.ok && /2 seconds/.test(r.error));
  assert.ok(!runBuilder(`function g(){ return new THREE.Group(); }`, "f").ok); // wrong name
  assert.ok(!runBuilder(`function f(){ return 5; }`, "f").ok); // not a group
  // a builder that keeps using process is told so, escalates to Pro, and ends failed without touching the process
  const dir = tmp();
  try {
    const llm = builders("```js\nexport function widget() { process.exit(1); }\n```");
    const res = await makeProp(llm, { id: "widget", description: "a widget", size: SIZE }, { dir });
    assert.equal(res.ok, false);
    assert.match(llm.calls[1].prompt, /remove the use of process/);
    assert.deepEqual(llm.calls.map((c) => c.tier), ["sonnet", "sonnet", "sonnet", "opus"]);
    assert.deepEqual(listGenerated(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("makeProp: an off-size prop is repaired on round 2", async () => {
  const dir = tmp();
  try {
    const llm = builders(widget(0.5), widget(0.26));
    const r = await makeProp(llm, { id: "widget", description: "a widget", size: SIZE }, { dir });
    assert.equal(r.ok, true, String(r.error));
    assert.equal(r.attempts, 2);
    assert.match(llm.calls[1].prompt, /width \(x\) is 50\.0 cm, wanted 26\.0 cm/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("makeProp: Pro writes the spec when the request has no size, and writes the code after Flash fails", async () => {
  const dir = tmp();
  try {
    const llm = new Fake((c) => {
      if (c.task === "plan") return { size: SIZE, parts: [{ name: "body", shape: "box", colour: "#b83a2e", where: "centre" }], placement: "onSurface" };
      if (c.task === "review") return { ok: true, fixes: [] };
      return c.tier === "opus" ? widget(0.26) : widget(0.7);
    });
    const events: PropEvent[] = [];
    const r = await makeProp(llm, { id: "widget", description: "a widget" }, { dir, emit: (e) => events.push(e) });
    assert.equal(r.ok, true, String(r.error));
    assert.equal(llm.calls[0].tier, "opus");
    assert.match(llm.calls[1].prompt, /26 cm wide/);
    assert.match(llm.calls[1].prompt, /body: box, #b83a2e/);
    assert.equal(r.attempts, 4); // 1 build + 2 repairs + Pro
    assert.ok(events.some((e) => e.step === "escalate"));
    assert.match(loadGeneratedMeta(dir).widget.source.by, /opus/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("makeProp: review fixes trigger one more round; a revision that breaks a check is dropped", async () => {
  const dir = tmp();
  try {
    let n = 0;
    const llm = new Fake((c) => c.task === "review" ? { ok: false, fixes: ["make it taller"] } : n++ === 0 ? widget(0.26) : widget(0.9));
    const r = await makeProp(llm, { id: "widget", description: "a widget", size: SIZE }, { dir });
    assert.equal(r.ok, true, String(r.error));
    assert.equal(r.attempts, 2);
    assert.match(llm.calls[2].prompt, /make it taller/);
    assert.match(readFileSync(join(dir, "widget.js"), "utf8"), /box\(g, 0\.26,/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("store: ids must be [a-z0-9_]+ and may not collide with library props", async () => {
  assert.match(idProblem("mug")!, /already exists in the library/);
  assert.match(idProblem("Bad-Id")!, /\[a-z0-9_\]\+/);
  assert.match(idProblem("meta")!, /reserved/);
  assert.equal(idProblem("fine_id_2"), null);
  const dir = tmp();
  try {
    const llm = builders(widget(0.26));
    const r = await makeProp(llm, { id: "kettle", description: "a kettle", size: SIZE }, { dir });
    assert.equal(r.ok, false);
    assert.match(r.error!, /already exists in the library/);
    assert.equal(llm.calls.length, 0); // refused before spending a call
    assert.throws(() => saveProp({ id: "mug", code: "", description: "", placement: "front", measured: { size: [1, 1, 1], y0: 0, center: [0, 0] }, by: "x" }, dir), /already exists/);
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("registry: generated props sit beside the library ones and never replace them", () => {
  for (const id of Object.keys(BASE_META)) assert.equal(PROP_META[id], BASE_META[id]);
  assert.ok(!existsSync(new URL("../library/props/generated/stovetop_kettle.js", import.meta.url)), "tests must not leave generated props in library/");
});
