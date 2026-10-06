import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEpisode, parseShow } from "../src/index.ts";
import { evaluate, workspace } from "../src/crew/guard.ts";
import { parsePatch } from "../src/scene/patch.ts";
import { BLOCKING_VERBS, PERFORMANCE_VERBS, type RoleId } from "../src/scene/registry.ts";
import { examplesFor, patchGuide, roleVocabulary, targetListing, type GuideCtx } from "../src/crew/patchguide.ts";
import { explainFailure, nearest, type FeedbackCtx } from "../src/crew/feedback.ts";
import { structure } from "../src/scene/parse.ts";

const SHOW = join(import.meta.dirname, "..", "shows", "kitchen");
const show = parseShow(readFileSync(join(SHOW, "show.scene"), "utf8"));
const ws = workspace(show, parseEpisode(readFileSync(join(SHOW, "ep01.scene"), "utf8")));
const ctx = (role: RoleId, targets: string[]): GuideCtx => ({ ws, show, role, targets });
const words = (s: string) => new Set(s.split(/[^a-z.@]+/i));

/** run a patch through parse + guard and return the failure reason the pipeline would hand to explainFailure */
function reasonOf(role: RoleId, patch: string, targets = ["1D"]): string {
  try {
    const ev = evaluate(ws, parsePatch(patch), { role, allowed: new Set(targets), requireChange: true });
    assert.equal(ev.ok, false, `expected ${patch} to fail`);
    return ev.reasons[0];
  } catch (e) {
    if (e instanceof assert.AssertionError) throw e;
    return (e as Error).message; // PatchError / SceneError thrown outside the guard's reasons
  }
}
const explain = (role: RoleId, patch: string, targets = ["1D"]) => explainFailure(patch, reasonOf(role, patch, targets), { ws, show, role, targets } as FeedbackCtx);

test("guide only carries the role's own verbs", () => {
  const an = words(patchGuide(ctx("animator", ["1D"])));
  assert.ok(an.has("shock") && !an.has("walk"));
  const bl = words(patchGuide(ctx("blocking", ["1D"])));
  assert.ok(bl.has("walk") && !bl.has("shock"));
  const wr = words(patchGuide(ctx("writer", ["1D"])));
  assert.ok(wr.has("whisper") && !wr.has("walk") && !wr.has("shock"));
  const dp = patchGuide(ctx("dp", ["1D"]));
  assert.match(dp, /MCU/);
  assert.match(dp, /push/);
  assert.match(dp, /practical/);
  assert.match(patchGuide(ctx("sound", ["1D"])), /fridge\.hum/);
  assert.match(patchGuide(ctx("editor", ["1D"])), /trim <head> <tail>/);
  for (const r of ["writer", "blocking", "dp", "animator", "editor", "sound"] as RoleId[]) assert.ok(patchGuide(ctx(r, ["1D"])).length < 2500, r);
  for (const v of Object.keys(PERFORMANCE_VERBS)) assert.ok(!words(patchGuide(ctx("blocking", ["1D"]))).has(v) || v in BLOCKING_VERBS, v);
});

test("vocabulary lists only characters from the target shot", () => {
  // 1A: kiran enters and mum sits; every character is named in the shot's lines, none is invented
  const st = structure(ws.doc);
  for (const id of ["1A", "1C", "1D"]) {
    const b = st.shots.find((s) => s.id === id)!;
    const named = new Set([...b.header.subjects, ...b.body.flatMap((l) => ("actor" in l.node ? [l.node.actor] : []))]);
    const v = roleVocabulary(ctx("animator", [id]));
    for (const n of named) if (show.cast[n]) assert.ok(v.characters.includes(n));
    for (const ch of v.characters) assert.ok(show.cast[ch]);
  }
  const g = patchGuide({ ...ctx("animator", ["1D"]), show: { ...show, cast: { kiran: show.cast.kiran } } });
  assert.ok(roleVocabulary(ctx("sound", ["1D"])).characters.length === 0);
  assert.ok(g.includes("Characters:"));
});

test("targetListing has every address of the target shot and none of the others", () => {
  const l = targetListing(ctx("animator", ["1D"]));
  for (const a of ["1D", "1D.1", "1D.2", "1D.3", "1D.4", "1D.5"]) assert.ok(new RegExp(`^[* ]${a.replace(".", "\\.")}\\s`, "m").test(l), a);
  // other shots appear only in the continuity note (what the next shot opens with), never as an address to edit
  const rows = l.split("\n").filter((x) => !x.trimStart().startsWith("continuity:"));
  assert.ok(rows.every((x) => !/\b1E(\.\d)?\b/.test(x) && !/\b1C(\.\d)?\b/.test(x)));
  assert.match(l, /continuity: .*opens 1E/);
  assert.match(l, /^\*1D\.2\s+kiran shock ~2\.5$/m);
  assert.match(l, /^ 1D\.1\s+kiran turn mum$/m);
  assert.match(l, /shot 1D: set kitchen; characters kiran mum; \d/);
  assert.match(l, /You may insert after: 1D 1D\.1/);
});

test("examples exist for each role and pass the guard", () => {
  for (const role of ["editor", "animator", "blocking", "sound", "dp", "writer"] as RoleId[]) {
    let found = 0;
    for (const t of ["1D", "1B", "1G"]) {
      const c = ctx(role, [t]);
      for (const ex of examplesFor(c)) {
        const ev = evaluate(ws, parsePatch(ex.patch), { role, allowed: new Set([t]), requireChange: true });
        assert.ok(ev.ok, `${role} ${t}: ${ex.patch}: ${ev.reasons.join("; ")}`);
        assert.ok(ex.purpose.length > 5);
        found++;
      }
    }
    if (role !== "writer") assert.ok(found >= 1, role);
  }
});

test("nearest finds typos", () => {
  assert.ok(nearest("wlak", Object.keys(BLOCKING_VERBS)).includes("walk"));
  assert.ok(nearest("shok", Object.keys(PERFORMANCE_VERBS)).includes("shock"));
  assert.deepEqual(nearest("zzzzzz", ["walk", "run"]), []);
});

test("explainFailure: unknown verb", () => {
  const m = explain("blocking", "1D.1 = kiran wlak fridge");
  assert.match(m, /^"wlak" is not a verb you can use\. Closest: walk\. Your verbs: enter exit walk/);
  assert.match(explain("animator", "1D.2 kiran shock -> kiran moonwalk"), /"moonwalk" is not a verb you can use\. Your verbs: look glare/);
});

test("explainFailure: bad address and other shot", () => {
  assert.equal(explain("animator", "1D.9 = kiran sigh"), "1D.9 does not exist. 1D has lines 1D.1 to 1D.5 (see the listing).");
  assert.equal(explain("animator", "1E.2 = mum sigh"), "1E is not one of your shots. Only change 1D.");
  assert.equal(explain("animator", "1Q.2 = mum sigh"), "Shot 1Q does not exist. Only change 1D.");
});

test("explainFailure: permission", () => {
  assert.equal(explain("sound", "1D.2 = kiran shock ~2"), 'As Sound you cannot change "kiran shock ~2.5" (an Animator line). Change only sfx/music/ambience/silence lines.');
  assert.match(explain("dp", "1D.1 = kiran sigh"), /^As DP you cannot change "kiran turn mum" \(a Blocking line\)\. Change only shot header and light lines\./);
  assert.match(explain("animator", "1D ++ 1X CU kiran"), /only the DP can/);
});

test("explainFailure: no-op, syntax, grammar", () => {
  assert.equal(explain("animator", "1D.2 = kiran shock ~2.5"), 'That patch changes nothing. The line already reads "kiran shock ~2.5". Make a different change.');
  assert.match(explain("animator", "1D.2 ~2.5 ->"), /^Edit form: "1D\.1 ~2 -> ~3"/);
  assert.match(explain("animator", "Here is my patch"), /^Each patch line starts with an address/);
  assert.match(explain("animator", "```"), /no markdown/);
  assert.match(explain("blocking", "1D.1 = kiran walk moon"), /"moon" is not an anchor or character for walk\.[^]*Use one of: door sink/);
  assert.match(explain("blocking", "1D.1 = kiran open"), /^open needs a target \(prop\)\. Options: cake fridge\.door fork mug\./);
  assert.match(explain("sound", "1D.3 sting -> boom"), /^"boom" is not a sfx name\. /);
  assert.match(explain("animator", "1D.2 foo -> bar"), /has no "foo"\. Copy the old tokens exactly/);
  assert.match(explain("animator", "1D.2 = kiran shock ~-1"), /not a duration\. Write ~N/);
  assert.match(explain("dp", "1D = 1D XX kiran"), /"XX" is not a shot type/);
});

test("explainFailure: locality and qc, with the pin form", () => {
  const m = explain("blocking", "1A.4 = kiran walk counter 1.0", ["1A"]);
  assert.match(m, /pin them with kiran@<anchor>/);
  assert.match(m, /1B/);
  assert.match(explain("editor", "1D -"), /alters the face 1E starts with/);
  assert.match(explainFailure("x", "qc: 1D kiran and mum intersect at 1.2s (20cm apart)", { ws, show, role: "blocking", targets: ["1D"] }), /new problem in 1D: kiran and mum intersect[^]*Move one of them/);
  assert.equal(explainFailure("x", "something odd", { ws, show, role: "blocking", targets: ["1D"] }), "Fix this: something odd");
});
