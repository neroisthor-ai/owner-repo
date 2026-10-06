// The ocean surface on the CPU, as Odyssey's shader computes it on the GPU (library/effects/odyssey_ocean).
// Iterated "exponential sine" waves: each octave is sharper, shorter and slower to travel than the last,
// and displaces the next octave's sample point (that is what gives the crests their lean).
import { sstep } from "./math.js";

// 41 fixed wave directions (x, z). Fixed so the CPU surface and the GPU surface agree exactly.
export const WDIR = [[-0.37908,-0.92537],[0.99432,-0.10645],[0.99038,-0.13838],[0.74041,-0.67215],[-0.22408,-0.97457],[0.88637,-0.46298],[0.93573,-0.35272],[0.84249,-0.53872],[0.85075,-0.52556],[-0.44157,-0.89722],[0.13313,-0.99110],[0.99986,0.01656],[0.41355,-0.91048],[-0.11449,-0.99342],[0.16123,-0.98692],[0.99401,-0.10929],[0.92184,-0.38758],[0.66567,-0.74624],[0.20616,-0.97852],[0.64781,-0.76180],[0.71194,-0.70224],[-0.54960,-0.83543],[0.45121,-0.89242],[-0.45174,-0.89215],[0.56232,-0.82692],[-0.01163,-0.99993],[0.96159,-0.27447],[0.83651,-0.54795],[-0.53393,-0.84553],[-0.50774,-0.86151],[-0.42983,-0.90291],[0.64105,-0.76750],[0.46869,-0.88336],[0.97364,-0.22810],[0.99540,-0.09578],[-0.10856,-0.99409],[0.81714,-0.57644],[-0.38677,-0.92218],[-0.54833,-0.83626],[0.99956,0.02957]];

/** Normalised height 0..1 at a point. it = octaves (12 on the CPU matches the shader's detail band). */
export function waves(px, pz, t, it = 12) {
  let freq = 0.034, amp = 1, h = 0, w = 0, spd = t * Math.sqrt(9.81 * 0.034);
  for (let i = 0; i < it; i++) {
    const d = WDIR[i];
    const x = (d[0] * px + d[1] * pz) * freq - spd;
    spd *= 1.0908712;
    const e = Math.exp(Math.sin(x) - 1), dx = e * Math.cos(x);
    h += e * amp; w += amp;
    px += d[0] * dx * amp * 0.30 / freq; pz += d[1] * dx * amp * 0.30 / freq;
    freq *= 1.19; amp *= 0.79;
  }
  return h / w;
}

/**
 * Surface height in metres. `whirl` (optional) adds a vortex: { center: [x, z], amount, spin }, with
 * `amount` 0..1 the strength (Charybdis), `spin` the accumulated angle. Without it this is plain sea.
 */
export function oceanHeight(px, pz, t, { iterations = 12, scale = 8.5, whirl = null } = {}) {
  if (!whirl) return (waves(px, pz, t, iterations) - 0.30) * scale;
  const C = whirl.center, W = whirl.amount, S = whirl.spin;
  const vx = px - C[0], vz = pz - C[1], r = Math.hypot(vx, vz) + 1e-3;
  const prof = 1 / (1 + r * r / (46 * 46)), ang = S * prof, cs = Math.cos(ang), sn = Math.sin(ang);
  const wv = waves(C[0] + cs * vx - sn * vz, C[1] + sn * vx + cs * vz, t, iterations);
  const damp = 1 - 0.82 * W * Math.exp(-r / 60);
  const h = (wv - 0.30) * scale * damp;
  const funnel = W * (36 * Math.pow(1 + r * r / (14 * 14), -1.25) + 6 * Math.exp(-r / 85));
  const th = Math.atan2(vz, vx);
  const spiral = Math.sin(th * 3 + Math.log(r) * 5.5 - S * 2.2) * W * 1.1 * sstep(6, 30, r) * Math.exp(-r / 130);
  return h - funnel + spiral;
}
