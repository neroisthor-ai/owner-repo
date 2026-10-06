// Fixed-step simulation, integrated once and cached (Odyssey's ship dynamics). A film is scrubbed
// back and forth and rendered frame by frame, so a simulation that depended on how it was played
// would never repeat: run it once at a fixed dt from before the clip starts, store every channel,
// and read it back by interpolation.
import { clamp } from "./math.js";

/**
 * One step of a damped spring pulling x towards `target` (semi-implicit Euler, as in Odyssey):
 *   w = natural frequency (rad/s), z = damping ratio. Returns [x, v].
 */
export function spring(x, v, target, w, z, dt, extra = 0) {
  v += (w * w * (target - x) - 2 * z * w * v + extra) * dt;
  x += v * dt;
  return [x, v];
}

/** Run `step(i, t, state)` for every fixed step in [t0, t1]; `channels` names the arrays that get recorded. */
export function simulate({ t0, t1, dt = 1 / 120, channels, step, init = {} }) {
  const n = Math.ceil((t1 - t0) / dt) + 1;
  const out = { dt, t0, n };
  for (const c of channels) out[c] = new Float32Array(n);
  const state = { ...init };
  for (let i = 0; i < n; i++) {
    const t = t0 + i * dt;
    step(i, t, state, out);
  }
  return out;
}

/** Linear read-back of a recorded channel at time t (clamped to the recorded range). */
export function sample(sim, channel, t) {
  const f = (t - sim.t0) / sim.dt, i = clamp(Math.floor(f), 0, sim.n - 2), u = clamp(f - i, 0, 1);
  const a = sim[channel];
  return a[i] * (1 - u) + a[i + 1] * u;
}
