// library/physics: deterministic, headless. Odyssey's hull and sea, Low Pass's flight, spray and trails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { oceanHeight, waves, hullStations, simulateHull, toWorld, track, orientFrom, Spray, Trail, replay, spring, simulate, sample, v3, type V3 } from "../library/physics/index.js";

const near = (a: number, b: number, tol: number, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b} (tol ${tol})`);

test("the sea: bounded, deterministic, moving, and a whirlpool digs a funnel", () => {
  for (let i = 0; i < 200; i++) { const w = waves(i * 13.7, i * 5.3, i * 0.37); assert.ok(w >= 0 && w <= 1, `height ${w}`); }
  assert.equal(oceanHeight(10, 20, 3), oceanHeight(10, 20, 3));
  assert.notEqual(oceanHeight(10, 20, 3), oceanHeight(10, 20, 3.5));
  const plain = oceanHeight(-90, 322, 5), whirl = oceanHeight(-90, 322, 5, { whirl: { center: [-90, 322], amount: 1, spin: 0 } });
  assert.ok(whirl < plain - 20, `funnel at the eye: ${whirl} vs ${plain}`);
  const far = oceanHeight(900, 900, 5), farW = oceanHeight(900, 900, 5, { whirl: { center: [-90, 322], amount: 1, spin: 0 } });
  near(far, farW, 1.5, "far from the vortex the sea is the same sea");
});

test("spring: critically damped settles on the target without overshoot, undamped rings", () => {
  let x = 0, v = 0;
  for (let i = 0; i < 600; i++) { [x, v] = spring(x, v, 1, 6, 1, 1 / 120); assert.ok(x < 1.02, "no overshoot"); }
  near(x, 1, 0.01);
  x = 0; v = 0; let over = false;
  for (let i = 0; i < 600; i++) { [x, v] = spring(x, v, 1, 6, 0.05, 1 / 120); if (x > 1.2) over = true; }
  assert.ok(over, "an underdamped spring overshoots");
});

test("simulate/sample: fixed step recording and interpolated read-back", () => {
  const s = simulate({ t0: 0, t1: 2, dt: 0.1, channels: ["x"], step: (i, t, _s, out) => { out.x[i] = t * 10; } });
  near(sample(s, "x", 0.55), 5.5, 1e-4);
  near(sample(s, "x", -3), 0, 1e-6, "clamped below");
  near(sample(s, "x", 99), 20, 1e-4, "clamped above");
});

const flat = { height: () => 0 };
const course = (t: number): [number, number] => [-16, 188 + 6.6 * t];

test("hull on flat water: sits at its draft, level, no surge, heading along the course", () => {
  const h = simulateHull({ path: course, sea: flat, t0: -8, t1: 10 });
  const s = h.at(5);
  near(s.heave, -0.35, 0.02, "draft");
  near(s.pitch, 0, 0.01); near(s.roll, 0, 0.01); near(s.surge, 0, 0.05);
  near(s.yaw, 0, 0.02, "course is straight along +z");
  near(s.pos[0], -16, 0.1); near(s.pos[2], 188 + 6.6 * 5, 0.2);
});

test("hull in waves: heaves and pitches within sane limits, stays bounded and finite", () => {
  const sea = { height: (x: number, z: number, t: number) => oceanHeight(x, z, t) };
  const h = simulateHull({ path: course, sea, t0: -8, t1: 20 });
  let hmin = 1e9, hmax = -1e9, pmax = 0, rmax = 0;
  for (let t = 0; t <= 20; t += 0.05) {
    const s = h.at(t);
    for (const v of [...s.pos, s.pitch, s.roll, s.yaw, ...s.quat]) assert.ok(Number.isFinite(v), `finite at ${t}`);
    hmin = Math.min(hmin, s.heave); hmax = Math.max(hmax, s.heave); pmax = Math.max(pmax, Math.abs(s.pitch)); rmax = Math.max(rmax, Math.abs(s.roll));
  }
  assert.ok(hmax - hmin > 0.5, `it should move with the sea (${hmax - hmin} m of heave)`);
  assert.ok(hmax - hmin < 12, "but not fly off");
  assert.ok(pmax < 0.6, `pitch ${pmax}`);
  assert.ok(rmax <= 0.2 + 1e-6, `roll is capped at 0.2 rad, got ${rmax}`);
});

test("hull: deterministic, orthonormal, unit quaternion", () => {
  const sea = { height: (x: number, z: number, t: number) => oceanHeight(x, z, t) };
  const a = simulateHull({ path: course, sea, t0: -4, t1: 6 }), b = simulateHull({ path: course, sea, t0: -4, t1: 6 });
  for (const t of [0, 1.234, 4.5]) assert.deepEqual(a.at(t), b.at(t));
  const s = a.at(3);
  for (const v of s.R) near(v3.len(v), 1, 1e-6, "unit basis");
  near(v3.dot(s.R[0], s.R[1]), 0, 1e-6); near(v3.dot(s.R[1], s.R[2]), 0, 1e-6);
  near(Math.hypot(...s.quat), 1, 1e-6, "unit quaternion");
  const w = toWorld(s, [0, 0, 0]);
  assert.deepEqual(w, s.pos);
});

test("hull: a turn makes it lean outward and the yaw follows the path", () => {
  const arc = (t: number): [number, number] => { const R = 60, w = 8 / R, a = w * t; return [R * (1 - Math.cos(a)), R * Math.sin(a)]; }; // turning to port, +x
  const h = simulateHull({ path: arc, sea: flat, t0: -6, t1: 14 });
  const s = h.at(10), s0 = h.at(2);
  assert.ok(s.yaw > s0.yaw + 0.5, "heading swings round");
  near(s.roll, 0.35 * (8 / 60), 0.012, "heel = turnHeel x turn rate (0.35 x 0.133 rad/s)");
});

test("hull: thrust shoves it forward along itself and the spring brings it back", () => {
  const h = simulateHull({ path: course, sea: flat, t0: -4, t1: 10, thrust: (t) => (t > 1 && t < 1.5 ? 6 : 0) });
  assert.ok(h.at(1.8).surge > 0.05, "pushed ahead");
  near(h.at(9.5).surge, 0, 0.05, "settled");
});

test("flight: a track passes through its keys, and carries on past the ends", () => {
  const keys = [[0, 0, 10, 0], [4, 40, 14, 5], [8, 80, 10, 40]];
  const p = track(keys);
  for (const k of keys) { const q = p(k[0]); near(q[0], k[1], 1e-9); near(q[1], k[2], 1e-9); near(q[2], k[3], 1e-9); }
  assert.ok(p(12)[0] > 80 && p(-4)[0] < 0, "extrapolates along the end tangents");
});

test("flight: straight and level has no bank and the nose follows the path", () => {
  const level = (t: number): V3 => [100 * t, 50, 0];
  const o = orientFrom(level, 3);
  near(o.bank, 0, 1e-6); near(o.u[1], 1, 1e-6);
  near(o.f[0], 1, 1e-6);
  near(Math.hypot(...o.quat), 1, 1e-6);
});

test("flight: a steady turn banks to atan(v^2 / (r g)) and maxBank caps it", () => {
  const v = 100, r = 400, w = v / r;
  const turn = (t: number): V3 => [r * Math.sin(w * t), 100, r * (1 - Math.cos(w * t))];
  const o = orientFrom(turn, 2);
  const expected = Math.atan((v * v) / (r * 9.81));
  near(Math.abs(o.bank), expected, 0.03, "bank angle from centripetal acceleration");
  const capped = orientFrom(turn, 2, { maxBank: 0.3 });
  near(Math.abs(capped.bank), 0.3, 1e-3);
  const none = orientFrom(turn, 2, { gain: 0 });
  near(none.bank, 0, 1e-6, "gain 0 never banks");
});

test("flight: a keyed roll turns the up vector about the nose", () => {
  const level = (t: number): V3 => [100 * t, 50, 0];
  const o = orientFrom(level, 3, { roll: Math.PI });
  near(o.u[1], -1, 1e-6, "upside down after a half roll");
  near(o.f[0], 1, 1e-6, "nose unchanged");
});

test("spray: nothing without strength; with it, droplets fall, land above water and die", () => {
  const s = new Spray({ waterY: 5, seed: 3 });
  s.step(0.1, { x: 0, z: 0, vx: 50, vz: 0, strength: 0 });
  assert.equal(s.alive, 0);
  for (let i = 0; i < 40; i++) s.step(1 / 40, { x: i, z: 0, vx: 50, vz: 0, strength: 1 });
  assert.ok(s.alive > 200, `many droplets (${s.alive})`);
  for (let i = 0; i < s.N; i++) if (s.life[i] > 0) assert.ok(s.pos[i * 3 + 1] >= 5.3 - 1e-6, "never below the water");
  for (let i = 0; i < 400; i++) s.step(1 / 40, null);
  assert.equal(s.alive, 0, "all gone once the emitter stops");
});

test("spray and replay: the same seed gives the same cloud, and replay rebuilds a state from nothing", () => {
  const emit = (t: number) => ({ x: t * 30, z: 0, vx: 30, vz: 0, strength: t < 1.5 ? 1 : 0 });
  const run = () => { const s = new Spray({ seed: 9 }); for (let t = 0; t < 2; t += 1 / 40) s.step(1 / 40, emit(t)); return s; };
  assert.deepEqual(Array.from(run().pos), Array.from(run().pos));
  const live = new Spray({ seed: 9 });
  for (let i = 0; i < 80; i++) live.step(1 / 40, emit(i / 40));
  const re = new Spray({ seed: 9 });
  replay({ reset: () => re.reset(), step: (tt, dt) => re.step(dt, emit(tt)), t: 2.0, window: 2.6, dt: 1 / 40 });
  assert.equal(re.alive, live.alive, "same number of droplets alive");
});

test("trail: a ring buffer that fades with age, widens, and builds a camera-facing ribbon", () => {
  const tr = new Trail({ maxPts: 20, width: 0.5, life: 2 });
  for (let i = 0; i < 50; i++) tr.push([i, 10, 0], i * 0.05, 1);
  assert.equal(tr.pts.length, 20, "ring buffer limit");
  const r = tr.build(2.45, [0, 10, 50]);
  assert.equal(r.count, 20);
  assert.ok(r.alpha[2] > 0 && r.alpha[2 * 10] < r.alpha[2], "older points are fainter");
  // the path runs along x and the camera is down +z, so the ribbon's width runs up the y axis
  const wNew = Math.abs(r.position[1 * 6 + 1] - r.position[1 * 6 + 4]);
  const wOld = Math.abs(r.position[15 * 6 + 1] - r.position[15 * 6 + 4]);
  assert.ok(wOld > wNew, "the trail spreads as it ages");
  tr.build(99, [0, 0, 0]);
  assert.equal(tr.pts.length, 0, "everything expires");
  assert.ok(hullStations().length > 10);
});
