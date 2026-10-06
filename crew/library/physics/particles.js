// Deterministic particles and trails (Low Pass's wingtip vortices and water spray). Both are driven by
// time only, with a seeded RNG, so a frame renders the same however it is reached. A sim that
// carries history (a trail, a spray cloud) is scrubbed by replaying the last couple of seconds: see replay().
import { rng, clamp } from "./math.js";

/** A pool of spray droplets thrown up where something fast skims the water. */
export class Spray {
  constructor({ count = 1400, gravity = 9.8, drag = 1.2, waterY = 0, rate = 800, seed = 1 } = {}) {
    this.N = count; this.g = gravity; this.drag = drag; this.waterY = waterY; this.rate = rate; this.seed = seed;
    this.pos = new Float32Array(count * 3); this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count); this.max = new Float32Array(count);
    this.size = new Float32Array(count); this.alpha = new Float32Array(count);
    this.reset();
  }
  reset() { this.life.fill(0); this.alpha.fill(0); this.acc = 0; this.next = 0; this.R = rng(this.seed); }
  /** Advance by dt. emitter = { x, z, vx, vz, strength 0..1 } (strength 0 emits nothing). */
  step(dt, e) {
    const R = this.R, N = this.N;
    this.acc += dt * this.rate * (e?.strength ?? 0);
    while (this.acc >= 1) {
      this.acc -= 1;
      const i = this.next; this.next = (this.next + 1) % N;
      this.pos[i * 3] = e.x - e.vx * 0.02 + (R() - 0.5) * 16; this.pos[i * 3 + 1] = this.waterY + 0.5; this.pos[i * 3 + 2] = e.z + (R() - 0.5) * 14;
      const a = R() * 6.283, sv = 6 + R() * 22;
      this.vel[i * 3] = e.vx * 0.12 + Math.cos(a) * sv; this.vel[i * 3 + 1] = 8 + R() * 26 * e.strength; this.vel[i * 3 + 2] = e.vz * 0.12 + Math.sin(a) * sv;
      this.max[i] = 1.2 + R() * 2.2; this.life[i] = this.max[i];
    }
    const drag = Math.exp(-dt * this.drag);
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.max[i]);
      this.vel[i * 3 + 1] -= this.g * dt; this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] = Math.max(this.waterY + 0.3, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = 2 + (1 - k) * 8; this.alpha[i] = 0.26 * k * Math.min(1, (1 - k) * 8);
    }
  }
  get alive() { let n = 0; for (let i = 0; i < this.N; i++) if (this.life[i] > 0) n++; return n; }
}

/** A ribbon trail: positions stamped over time, fading with age and widening as they spread. */
export class Trail {
  constructor({ maxPts = 110, width = 0.16, life = 2.2 } = {}) { this.maxPts = maxPts; this.w0 = width; this.life = life; this.pts = []; }
  reset() { this.pts.length = 0; }
  push(p, t, k = 1) { this.pts.unshift({ p: [p[0], p[1], p[2]], t, k }); if (this.pts.length > this.maxPts) this.pts.pop(); }
  /** Triangle-strip data facing a camera at `cam`: { position: Float32Array(n*2*3), alpha: Float32Array(n*2), count } */
  build(now, cam) {
    const pts = this.pts;
    while (pts.length && now - pts[pts.length - 1].t > this.life) pts.pop();
    const n = pts.length, M = this.maxPts, position = new Float32Array(M * 6), alpha = new Float32Array(M * 2);
    for (let i = 0; i < M; i++) {
      if (i >= n) { const P = n ? pts[n - 1].p : [0, 0, 0]; position.set([...P, ...P], i * 6); continue; }
      const P = pts[i], age = now - P.t, Q = pts[Math.min(n - 1, i + 1)], Pp = pts[Math.max(0, i - 1)];
      let d = [Pp.p[0] - Q.p[0], Pp.p[1] - Q.p[1], Pp.p[2] - Q.p[2]];
      if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] < 1e-6) d = [1, 0, 0];
      const dl = Math.hypot(...d); d = d.map((v) => v / dl);
      let tc = [cam[0] - P.p[0], cam[1] - P.p[1], cam[2] - P.p[2]]; const tl = Math.hypot(...tc) || 1; tc = tc.map((v) => v / tl);
      let s = [d[1] * tc[2] - d[2] * tc[1], d[2] * tc[0] - d[0] * tc[2], d[0] * tc[1] - d[1] * tc[0]]; const sl = Math.hypot(...s) || 1; s = s.map((v) => v / sl);
      const w = this.w0 * (1 + age * 2.2);
      position.set([P.p[0] - s[0] * w, P.p[1] - s[1] * w, P.p[2] - s[2] * w, P.p[0] + s[0] * w, P.p[1] + s[1] * w, P.p[2] + s[2] * w], i * 6);
      alpha[i * 2] = alpha[i * 2 + 1] = P.k * Math.pow(clamp(1 - age / this.life, 0, 1), 1.6) * Math.min(1, age * 25 + 0.1) * (i < n - 1 ? 1 : 0);
    }
    return { position, alpha, count: n };
  }
}

/**
 * Put a history-carrying simulation at time t by replaying the last `window` seconds from a clean state
 * (Low Pass's seekTo). `reset()` clears it; `step(time, dt)` advances it one fixed step.
 */
export function replay({ reset, step, t, window = 2.6, dt = 1 / 40 }) {
  reset();
  const start = Math.max(0, t - window), n = Math.round((t - start) / dt); // integer step count: no float drift
  for (let i = 0; i < n; i++) step(start + i * dt, dt);
}
