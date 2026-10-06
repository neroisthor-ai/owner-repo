// Flying along a path: Low Pass's flight-path tools. A path is a function of time; the aircraft's
// attitude comes from the path itself (it banks into turns, pulls up in climbs) rather than being keyed.
import { clamp, quatFromBasis, v3 } from "./math.js";

/**
 * A smooth path through keys [[t, x, y, z], ...] (cubic Hermite, finite-difference tangents), as a
 * function of time; it carries on along the end tangents outside the keyed range.
 */
export function track(keys) {
  const n = keys.length, T = keys.map((k) => k[0]), P = keys.map((k) => [k[1], k[2] || 0, k[3] || 0]);
  const M = P.map((p, i) => {
    if (i === 0) return v3.mul(v3.sub(P[1], P[0]), 1 / (T[1] - T[0]));
    if (i === n - 1) return v3.mul(v3.sub(P[n - 1], P[n - 2]), 1 / (T[n - 1] - T[n - 2]));
    return v3.mul(v3.sub(P[i + 1], P[i - 1]), 1 / (T[i + 1] - T[i - 1]));
  });
  return (t) => {
    if (t <= T[0]) return v3.add(P[0], v3.mul(M[0], t - T[0]));
    if (t >= T[n - 1]) return v3.add(P[n - 1], v3.mul(M[n - 1], t - T[n - 1]));
    let i = 0; while (t > T[i + 1]) i++;
    const h = T[i + 1] - T[i], s = (t - T[i]) / h, s2 = s * s, s3 = s2 * s;
    const a = 2 * s3 - 3 * s2 + 1, b = (s3 - 2 * s2 + s) * h, c = -2 * s3 + 3 * s2, d = (s3 - s2) * h;
    return [0, 1, 2].map((k) => P[i][k] * a + M[i][k] * b + P[i + 1][k] * c + M[i + 1][k] * d);
  };
}

/**
 * Attitude from a path at time t. The "up" vector is the felt acceleration (centripetal plus gravity),
 * averaged over three nearby samples; `gain` scales how hard the aircraft banks, `maxBank` (rad) caps it,
 * `roll` (rad) adds a keyed roll about the nose (a barrel roll).
 * -> { f (nose), u (up), x (right), quat [x,y,z,w], bank (rad) }
 */
export function orientFrom(fn, t, { gain = 1, roll = 0, maxBank = 0 } = {}) {
  const f = v3.norm(v3.sub(fn(t + 0.06), fn(t - 0.06)));
  let u = [0, 0, 0];
  for (const o of [-0.35, 0, 0.35]) {
    const a = fn(t + o - 0.25), c = fn(t + o), b = fn(t + o + 0.25);
    u = [u[0] + (b[0] - 2 * c[0] + a[0]) / 0.0625, u[1] + (b[1] - 2 * c[1] + a[1]) / 0.0625, u[2] + (b[2] - 2 * c[2] + a[2]) / 0.0625];
  }
  u = v3.mul(u, gain / 3); u[1] += 9.81;
  u = v3.sub(u, v3.mul(f, v3.dot(u, f)));
  u = v3.dot(u, u) < 1e-6 ? [0, 1, 0] : v3.norm(u);
  const up0 = v3.norm(v3.sub([0, 1, 0], v3.mul(f, f[1])));
  if (maxBank) {
    const cb = clamp(v3.dot(u, up0), -1, 1);
    if (Math.acos(cb) > maxBank) {
      const side = v3.norm(v3.sub(u, v3.mul(up0, cb)));
      u = v3.add(v3.mul(up0, Math.cos(maxBank)), v3.mul(side, Math.sin(maxBank)));
    }
  }
  let x = v3.cross(u, f);
  if (roll) { const c = Math.cos(roll), s = Math.sin(roll); const x2 = v3.add(v3.mul(x, c), v3.mul(u, s)); u = v3.sub(v3.mul(u, c), v3.mul(x, s)); x = x2; }
  const bank = Math.acos(clamp(v3.dot(u, up0), -1, 1)) * Math.sign(v3.dot(v3.cross(up0, u), f) || 1);
  return { f, u, x, quat: quatFromBasis(x, u, f), bank };
}
