// The frontend's DOM-free code: export formats (timecode, CSV, SRT, EDL, FCP XML, OTIO, zip), camera maths,
// and the film look's grades, environments and sampling. Browser behaviour is covered by test/e2e/*.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32 as zcrc32 } from "node:zlib";
import * as THREE from "three";
import { tc, csv, srt, srtTime, chapters, clipPlan, edl, fcpxml, crc32, zipStore, eulerZXY, toBlenderPos, toBlenderQuat, focalFromFov, parseEdl, parseOtio, patchOtio, compareCuts, qmul } from "../web/crew/exports/pure.js";
import { halton, cocFactor, infoAt } from "../web/crew/render/look.js";
import { gradeFor, GRADES } from "../web/crew/render/grades.js";
import { ENV, envFor, sunDir } from "../web/crew/render/atmos.js";

const near = (a: number, b: number, tol: number, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b} (tol ${tol})`);
const SHOTS = [
  { id: "1A", label: "WS", cutStart: 0, cutDur: 6.5 },
  { id: "1B", label: "MCU kiran", cutStart: 6.5, cutDur: 2.25 },
  { id: "1C", label: "CU mum", cutStart: 8.75, cutDur: 3 },
];

test("timecode, CSV and SRT", () => {
  assert.equal(tc(0, 24), "00:00:00:00");
  assert.equal(tc(31.2, 24), "00:00:31:05");
  assert.equal(tc(3725.48, 25), "01:02:05:12");
  assert.equal(csv([["a,b", 'say "hi"', 3, null]]), '"a,b","say ""hi""",3,\r\n');
  assert.equal(srtTime(3.5), "00:00:03,500");
  assert.equal(srt([{ t: 1, dur: 1.5, text: "Hello." }, { t: 3, dur: 1, text: "Bye." }]), "1\n00:00:01,000 --> 00:00:02,500\nHello.\n\n2\n00:00:03,000 --> 00:00:04,000\nBye.\n");
});

test("chapters start at 0:00 and warn about what YouTube ignores", () => {
  const c = chapters([{ t: 5, title: "One" }, { t: 20, title: "Two" }, { t: 25, title: "Three" }]);
  assert.match(c.text, /^0:00 One\n0:20 Two\n0:25 Three\n$/);
  assert.ok(c.warnings.some((w) => /under 10 seconds/.test(w)), "Two is 5s long");
  assert.ok(chapters([{ t: 0, title: "a" }]).warnings.some((w) => /at least 3/.test(w)));
  assert.match(chapters([{ t: 0, title: "a" }, { t: 4000, title: "b" }, { t: 4100, title: "c" }]).text, /1:06:40 b/);
});

test("clip plan: handles clamp at both ends, names keep shot ids or number them", () => {
  const p = clipPlan(SHOTS, 24, 12, 11.75);
  assert.deepEqual(p.map((x) => [x.id, x.lead, x.tail, x.clipLen]), [["1A", 0, 12, 168], ["1B", 12, 12, 78], ["1C", 12, 0, 84]]);
  for (const x of p) { assert.equal(x.srcOut - x.srcIn, x.recOut - x.recIn); assert.equal(x.clipLen, x.lead + (x.recOut - x.recIn) + x.tail); }
  assert.equal(p[1].recIn, 156);
  assert.deepEqual(clipPlan(SHOTS, 24, 0, 11.75, { keepIds: false }).map((x) => x.name), ["shot_001", "shot_002", "shot_003"]);
});

test("EDL round-trips through parseEdl and names its clips", () => {
  const plans = clipPlan(SHOTS, 24, 12, 11.75);
  const text = edl("Midnight Snack", 24, plans);
  assert.match(text, /^TITLE: Midnight Snack\nFCM: NON-DROP FRAME\n/);
  const ev = parseEdl(text, 24);
  assert.equal(ev.length, 3);
  assert.deepEqual(ev.map((e) => e.name), ["1A", "1B", "1C"]);
  assert.deepEqual(ev.map((e) => [e.recIn, e.recOut]), plans.map((p) => [p.recIn, p.recOut]));
  assert.deepEqual(ev.map((e) => [e.srcIn, e.srcOut]), plans.map((p) => [p.srcIn, p.srcOut]));
});

test("FCP XML: one clipitem per shot, in/out/start/end from the plan, escaped names", () => {
  const plans = clipPlan(SHOTS, 24, 12, 11.75);
  const x = fcpxml('A & "B"', 24, plans, { width: 1280, height: 720 });
  assert.ok(x.startsWith('<?xml version="1.0"'));
  assert.equal((x.match(/<clipitem /g) ?? []).length, 3);
  assert.equal((x.match(/<clipitem /g) ?? []).length, (x.match(/<\/clipitem>/g) ?? []).length);
  assert.match(x, /<name>A &amp; &quot;B&quot;<\/name>/);
  assert.match(x, /<start>156<\/start>\s*<end>210<\/end>\s*<in>12<\/in>\s*<out>66<\/out>/);
});

test("OTIO: patched to the exported clips, parsed back, and the cuts compared", () => {
  const rt = (v: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate: 24, value: v });
  const clip = (name: string, v: number) => ({ OTIO_SCHEMA: "Clip.2", name, source_range: { start_time: rt(0), duration: rt(v) } });
  const otio = { tracks: { children: [{ kind: "Video", children: [clip("1A WS", 156), clip("1B MCU kiran", 54), clip("1C CU mum", 72)] }, { kind: "Audio", name: "Dialogue", children: [] }] } };
  const plans = clipPlan(SHOTS, 24, 12, 11.75);
  patchOtio(otio, plans, 24);
  const c = otio.tracks.children[0].children[1] as any;
  assert.equal(c.name, "1B");
  assert.equal(c.source_range.start_time.value, 12);
  assert.equal(c.media_references.DEFAULT_MEDIA.target_url, "1B.mp4");
  assert.equal(c.media_references.DEFAULT_MEDIA.available_range.duration.value, 78);
  const ev = parseOtio(otio, 24);
  assert.deepEqual(ev.map((e) => e.name), ["1A", "1B", "1C"]);
  assert.deepEqual(ev.map((e) => e.recOut - e.recIn), [156, 54, 72]);
  const cmp = compareCuts(clipPlan(SHOTS, 24, 0), [{ name: "1A.mp4", recIn: 0, recOut: 156 }, { name: "1B", recIn: 156, recOut: 190 }, { name: "9Z", recIn: 190, recOut: 200 }]);
  assert.deepEqual(cmp.rows.map((r) => [r.id, r.diff]), [["1A", 0], ["1B", -20], ["1C", null]]);
  assert.deepEqual(cmp.unmatched, ["9Z"]);
});

test("zip: valid central directory and CRCs that match zlib's", () => {
  const files = [{ name: "a.txt", data: new TextEncoder().encode("hello") }, { name: "dir/é.bin", data: new Uint8Array([0, 1, 2, 255, 254]) }, { name: "empty", data: new Uint8Array(0) }];
  for (const f of files) assert.equal(crc32(f.data), zcrc32(f.data) >>> 0, f.name);
  const z = zipStore(files), dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const eocd = z.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  assert.equal(dv.getUint16(eocd + 10, true), 3, "entries");
  const cdOff = dv.getUint32(eocd + 16, true);
  assert.equal(dv.getUint32(cdOff, true), 0x02014b50);
  const off = dv.getUint32(cdOff + 42, true);
  assert.equal(dv.getUint32(off, true), 0x04034b50, "the first entry's offset points at a local header");
});

test("camera maths: ZXY Euler matches three.js YXZ; the Blender conversion keeps the view direction", () => {
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    const q = new THREE.Quaternion().random(), e = new THREE.Euler().setFromQuaternion(q, "YXZ"), a = eulerZXY([q.x, q.y, q.z, q.w]);
    worst = Math.max(worst, Math.abs(a[0] - (e.x * 180) / Math.PI), Math.abs(a[1] - (e.y * 180) / Math.PI), Math.abs(a[2] - (e.z * 180) / Math.PI));
    // three: camera looks down -Z. Blender: world is Z up, camera also looks down its local -Z.
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q), qb = toBlenderQuat([q.x, q.y, q.z, q.w]);
    const fb = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(qb[0], qb[1], qb[2], qb[3]));
    const want = toBlenderPos([f.x, f.y, f.z]);
    near(fb.x, want[0], 1e-9); near(fb.y, want[1], 1e-9); near(fb.z, want[2], 1e-9);
    // and the up vector (local +Y) too
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(q), ub = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(qb[0], qb[1], qb[2], qb[3])), wu = toBlenderPos([u.x, u.y, u.z]);
    near(ub.x, wu[0], 1e-9); near(ub.y, wu[1], 1e-9); near(ub.z, wu[2], 1e-9);
  }
  assert.ok(worst < 1e-9, `euler worst ${worst}`);
  near(focalFromFov(2 * Math.atan(12 / 35) * (180 / Math.PI), 24), 35, 1e-6, "35 mm on the show's 36x24 sensor");
  const q = qmul([0, 0, 0, 1], [0.1, 0.2, 0.3, 0.9]);
  assert.deepEqual(q, [0.1, 0.2, 0.3, 0.9], "identity");
});

test("film look: halton is low-discrepancy, blur radius follows the thin lens", () => {
  const xs = Array.from({ length: 64 }, (_, i) => halton(i + 1, 2));
  assert.equal(new Set(xs).size, 64);
  for (const x of xs) assert.ok(x > 0 && x < 1);
  const buckets = new Array(8).fill(0);
  for (const x of xs) buckets[Math.floor(x * 8)]++;
  assert.ok(buckets.every((n) => n === 8), `each eighth gets 8 of 64 points: ${buckets}`);
  // wider aperture, longer lens, closer focus: more blur
  const base = cocFactor(35, 2.8, 3, 1080, 24);
  assert.ok(cocFactor(35, 1.4, 3, 1080, 24) > base * 1.9);
  assert.ok(cocFactor(85, 2.8, 3, 1080, 24) > base * 4);
  assert.ok(cocFactor(35, 2.8, 1, 1080, 24) > base);
  near(cocFactor(35, 2.8, 3, 2160, 24), base * 2, 1e-9, "scales with the render height");
});

test("film look: every mood has a grade and an environment; bright and night differ the right way", () => {
  for (const light of ["day", "night", "warm", "cool", "dim", "bright", "practical", "moon"]) {
    const g = gradeFor({ light }), e = envFor({ light });
    assert.ok(g.key > 0 && g.emax > g.emin, light);
    assert.ok(e.sun.length === 3 && e.zen.length === 3, light);
    assert.ok(g.exp > 0 && g.vig >= 0, light);
  }
  assert.ok(gradeFor({ light: "bright" }).vig < gradeFor({ light: "day" }).vig, "high key has a lighter vignette");
  assert.ok(gradeFor({ light: "night" }).key < gradeFor({ light: "day" }).key, "night meters darker");
  assert.equal(gradeFor({ light: "night" }).streak, 0.035);
  assert.equal(gradeFor({ light: "day" }).dirt, 1);
  assert.equal(gradeFor({ light: "nonsense" }).key, GRADES.campusD.key, "unknown moods fall back to daylight");
  assert.ok(ENV.night.elev < 0 && ENV.warm.elev < ENV.day.elev && ENV.day.elev < ENV.bright.elev);
  const d = sunDir(THREE, { x: -4, z: 6 }, ENV.day);
  near(Math.hypot(d.x, d.y, d.z), 1, 1e-9);
  near(Math.asin(d.y) * (180 / Math.PI), ENV.day.elev, 1e-6, "elevation from the mood");
  near(Math.atan2(d.x, d.z), Math.atan2(-4, 6), 1e-9, "azimuth from the key light");
});

test("infoAt finds the shot a cut time lands in", () => {
  const baked = { fps: 24, shots: SHOTS };
  assert.equal(infoAt(baked, 0).shot.id, "1A");
  assert.equal(infoAt(baked, 6.5).shot.id, "1B");
  assert.equal(infoAt(baked, 8.8).shot.id, "1C");
  assert.equal(infoAt(baked, 99).shot.id, "1C");
  assert.equal(infoAt(baked, 7.5).o, 24);
});
