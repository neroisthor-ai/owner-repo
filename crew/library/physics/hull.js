// A buoyant hull on a moving sea: Odyssey's ship dynamics, generalised. The course over the ground is
// art-directed (you give `path`); heave, pitch, roll, yaw lag and surge are simulated by damped springs
// that chase the water under the hull. Integrated once at a fixed step, then read back by time.
import { clamp, v3, quatFromBasis } from "./math.js";
import { simulate, sample, spring } from "./sim.js";

/** Sample stations along the waterline: a centreline plus a port and starboard point per station. */
export function hullStations({ halfLength = 17, halfBeam = 2.55, step = 2.5, reach = 15 } = {}) {
  const pts = [];
  for (let z = -reach; z <= reach + 0.01; z += step) {
    const hb = halfBeam * Math.sqrt(Math.max(1 - (z / halfLength) ** 2, 0));
    pts.push([0, z]);
    if (Math.abs(z) < reach - 2) { pts.push([-hb * 0.9, z]); pts.push([hb * 0.9, z]); }
  }
  return pts;
}

// natural frequency (rad/s) from a period in seconds
const W = (period) => (2 * Math.PI) / period;

export const DEFAULTS = {
  heave: { period: 2.6, zeta: 0.45 }, pitch: { period: 3.4, zeta: 0.32 }, roll: { period: 4.6, zeta: 0.2 },
  yaw: { period: 3.2, zeta: 0.7 }, surge: { period: 5, zeta: 0.5 },
  draft: 0.35,        // metres the waterline sits below the mean surface under the hull
  pitchGain: 0.85,    // how much of the wave slope the hull follows
  rollGain: 0.55,
  maxRoll: 0.2,       // radians
  turnHeel: 0.35,     // outward lean per rad/s of turn
  slideGain: 3.0,     // slope pushes the hull along itself
  yawSlide: 0.25,     // cross slope pushes the stern round
};

/**
 * simulateHull({
 *   path(t) -> [x, z]            the course over the ground
 *   sea: { height(x, z, t), step?(t, dt) }   the water; step() lets it advance its own state (a whirlpool's spin)
 *   t0, t1, dt = 1/120           run from before the clip starts, so the hull has settled
 *   stations = hullStations()    where the hull samples the water
 *   heel?(t)   rad, steady lean (wind on a sail)           thrust?(t, dt)  surge force (oar strokes, engine)
 *   params?    overrides for DEFAULTS
 * }) -> { at(t) }  with at(t) = { pos, quat, R, yaw, pitch, roll, heave, surge }
 */
export function simulateHull({ path, sea, t0, t1, dt = 1 / 120, stations = hullStations(), heel = null, thrust = null, params = {} }) {
  const P = { ...DEFAULTS, ...params };
  for (const k of ["heave", "pitch", "roll", "yaw", "surge"]) P[k] = { ...DEFAULTS[k], ...(params[k] ?? {}) };
  const wH = W(P.heave.period), wP = W(P.pitch.period), wR = W(P.roll.period), wY = W(P.yaw.period), wS = W(P.surge.period);
  let sx2 = 0, sz2 = 0;
  for (const q of stations) { sx2 += q[0] * q[0]; sz2 += q[1] * q[1]; }
  const sim = simulate({
    t0, t1, dt, channels: ["heave", "pitch", "roll", "yaw", "surge"],
    init: { h: null, hv: 0, pt: 0, pv: 0, rl: 0, rv: 0, yw: null, yv: 0, su: 0, sv: 0 },
    step(i, t, s, out) {
      const tc = Math.max(t, 0);
      const [x, z] = path(tc), [x2, z2] = path(tc + 0.05);
      const yawPath = Math.atan2(x2 - x, z2 - z);
      if (s.yw === null) s.yw = yawPath;
      const cy = Math.cos(s.yw), sy = Math.sin(s.yw);
      // least-squares plane through the water under the hull: mean height, slope along and across
      let m = 0, gz = 0, gx = 0;
      for (const q of stations) {
        const wx = x + cy * q[0] + sy * (q[1] + s.su), wz = z - sy * q[0] + cy * (q[1] + s.su);
        const hh = sea.height(wx, wz, t);
        m += hh; gz += hh * q[1]; gx += hh * q[0];
      }
      m /= stations.length; gz /= sz2 || 1; gx /= sx2 || 1;
      if (s.h === null) { s.h = m - P.draft; s.pt = -Math.atan(gz); s.rl = Math.atan(gx); }
      const heaveT = m - P.draft;
      const pitchT = -Math.atan(gz) * P.pitchGain; // + lowers the bow
      let rollT = Math.atan(gx) * P.rollGain;      // + raises starboard
      const heading = (u) => { const p0 = path(u), p1 = path(u + 0.05); return Math.atan2(p1[0] - p0[0], p1[1] - p0[1]); };
      const turnRate = (heading(tc + 0.1) - heading(tc - 0.1)) / 0.2; // Odyssey's finite difference
      rollT += (heel ? heel(tc) : 0) + P.turnHeel * wrap(turnRate);
      rollT = clamp(rollT, -P.maxRoll, P.maxRoll);
      const F = thrust ? thrust(tc, dt) : 0;
      [s.h, s.hv] = spring(s.h, s.hv, heaveT, wH, P.heave.zeta, dt);
      [s.pt, s.pv] = spring(s.pt, s.pv, pitchT, wP, P.pitch.zeta, dt);
      [s.rl, s.rv] = spring(s.rl, s.rv, rollT, wR, P.roll.zeta, dt);
      const dy = wrap(yawPath - s.yw);
      [s.yw, s.yv] = spring(s.yw, s.yv, s.yw + dy, wY, P.yaw.zeta, dt, gx * P.yawSlide);
      // the surge spring is about zero: it is the hull's offset along itself from the art-directed course
      s.sv += (F - wS * wS * s.su - 2 * P.surge.zeta * wS * s.sv - gz * P.slideGain) * dt; s.su += s.sv * dt;
      sea.step?.(t, dt);
      out.heave[i] = s.h; out.pitch[i] = s.pt; out.roll[i] = s.rl; out.yaw[i] = s.yw; out.surge[i] = s.su;
    },
  });
  return {
    sim,
    at(t) {
      const [x0, z0] = path(t);
      const yaw = sample(sim, "yaw", t), pitch = sample(sim, "pitch", t), roll = sample(sim, "roll", t), heave = sample(sim, "heave", t), surge = sample(sim, "surge", t);
      const x = x0 + Math.sin(yaw) * surge, z = z0 + Math.cos(yaw) * surge;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
      const pitchM = (v) => [v[0], v[1] * cp - v[2] * sp, v[1] * sp + v[2] * cp];
      const yawM = (v) => [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
      const right = yawM(pitchM([cr, sr, 0])), up = yawM(pitchM([-sr, cr, 0])), fwd = yawM(pitchM([0, 0, 1]));
      return { pos: [x, heave, z], R: [right, up, fwd], quat: quatFromBasis(right, up, fwd), yaw, pitch, roll, heave, surge };
    },
  };
}

/** Ship-local point to world, for the transform `at()` returns. */
export const toWorld = (ship, l) => v3.add(ship.pos, [
  ship.R[0][0] * l[0] + ship.R[1][0] * l[1] + ship.R[2][0] * l[2],
  ship.R[0][1] * l[0] + ship.R[1][1] * l[1] + ship.R[2][1] * l[2],
  ship.R[0][2] * l[0] + ship.R[1][2] * l[1] + ship.R[2][2] * l[2],
]);

function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
