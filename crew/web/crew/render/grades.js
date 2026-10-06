// Colour grades, taken from The Bob's film pipeline (library/reference/the_bob). Each grade is the
// whole look: exposure, bloom and halation, lift/gain, split toning, saturation, contrast,
// chromatic aberration, vignette, grain. `key` is the middle-grey the auto exposure aims for.
const G = (o) => o;
export const GRADES = {
  lawn:    G({ exp: 1.0,  bloom: 0.22, hal: 0.12, th: 1.1, lift: [0.018, 0.012, 0.004], gain: [1.05, 1.0, 0.87], sh: [0.86, 1.0, 1.08], hi: [1.09, 1.0, 0.85], split: 0.6,  sat: 1.04, con: 0.42, ca: 0.008, vig: 0.5,  grain: 0.07,  cam: 1, key: 0.15,  tau: 0.4 }),
  lib:     G({ exp: 2.1,  bloom: 0.3,  hal: 0.2,  th: 1.0, lift: [0.01, 0.018, 0.026],  gain: [1.06, 0.98, 0.88], sh: [0.82, 0.98, 1.12], hi: [1.12, 0.98, 0.82], split: 0.75, sat: 0.86, con: 0.32, ca: 0.005, vig: 0.6,  grain: 0.045, cam: 0, key: 0.026, tau: 0.5 }),
  corr:    G({ exp: 0.72, bloom: 0.2,  hal: 0.08, th: 1.2, lift: [0.012, 0.014, 0.016], gain: [1.06, 1.0, 0.9],   sh: [0.9, 1.0, 1.08],   hi: [1.08, 1.0, 0.88],  split: 0.5,  sat: 1.0,  con: 0.3,  ca: 0.004, vig: 0.4,  grain: 0.035, cam: 0, key: 0.2,   tau: 0.4 }),
  room:    G({ exp: 1.6,  bloom: 0.35, hal: 0.15, th: 0.9, lift: [0.005, 0.01, 0.03],   gain: [0.92, 0.98, 1.12], sh: [0.8, 0.95, 1.2],   hi: [1.0, 1.0, 1.05],   split: 0.6,  sat: 0.85, con: 0.35, ca: 0.004, vig: 0.65, grain: 0.05,  cam: 0, key: 0.03,  tau: 0.6 }),
  rain:    G({ exp: 1.3,  bloom: 0.3,  hal: 0.12, th: 1.0, lift: [0.01, 0.016, 0.024],  gain: [0.96, 1.0, 1.06],  sh: [0.85, 0.98, 1.12], hi: [1.06, 1.0, 0.9],   split: 0.55, sat: 0.72, con: 0.32, ca: 0.004, vig: 0.6,  grain: 0.05,  cam: 0, key: 0.19,  tau: 0.5 }),
  staff:   G({ exp: 1.25, bloom: 0.24, hal: 0.12, th: 1.1, lift: [0.012, 0.012, 0.016], gain: [1.04, 1.0, 0.92],  sh: [0.88, 0.98, 1.1],  hi: [1.08, 1.0, 0.88],  split: 0.5,  sat: 0.9,  con: 0.3,  ca: 0.004, vig: 0.5,  grain: 0.04,  cam: 0, key: 0.2,   tau: 0.4 }),
  night:   G({ exp: 1.2,  bloom: 0.34, hal: 0.22, th: 0.9, lift: [0.004, 0.01, 0.018], gain: [1.06, 0.98, 0.86], sh: [0.78, 0.98, 1.18], hi: [1.14, 0.98, 0.8],  split: 0.75, sat: 0.8,  con: 0.38, ca: 0.005, vig: 0.7,  grain: 0.05,  cam: 0, key: 0.11,  tau: 1.2 }),
  bw:      G({ exp: 1.0,  bloom: 0.2,  hal: 0.0,  th: 1.1, lift: [0.03, 0.03, 0.03],    gain: [1, 1, 1],        sh: [1, 1, 1],        hi: [1, 1, 1],        split: 0,    sat: 0,    con: 0.5,  ca: 0.006, vig: 0.6,  grain: 0.11,  cam: 1, key: 0.15,  tau: 0.4 }),
  campusD: G({ exp: 1.0,  bloom: 0.18, hal: 0.08, th: 1.3, lift: [0.01, 0.01, 0.014],   gain: [1.05, 1.0, 0.9],   sh: [0.9, 1.0, 1.08],   hi: [1.08, 1.0, 0.86],  split: 0.5,  sat: 0.9,  con: 0.4,  ca: 0.003, vig: 0.4,  grain: 0.03,  cam: 0, key: 0.2,   tau: 0.5 }),
  campusN: G({ exp: 1.0,  bloom: 0.4,  hal: 0.25, th: 0.9, lift: [0.004, 0.008, 0.02],  gain: [1.04, 0.98, 0.9],  sh: [0.75, 0.95, 1.25], hi: [1.15, 0.98, 0.78], split: 0.8,  sat: 0.85, con: 0.36, ca: 0.004, vig: 0.65, grain: 0.05,  cam: 0, key: 0.032, tau: 0.8 }),
  campusS: G({ exp: 1.0,  bloom: 0.25, hal: 0.12, th: 1.0, lift: [0.012, 0.016, 0.022], gain: [0.96, 1.0, 1.05],  sh: [0.85, 0.98, 1.12], hi: [1.04, 1.0, 0.92],  split: 0.5,  sat: 0.62, con: 0.34, ca: 0.004, vig: 0.6,  grain: 0.05,  cam: 0, key: 0.13,  tau: 0.5 }),
};
for (const g of Object.values(GRADES)) { g.emin = 0.12; g.emax = 8; }

/** Crew's light moods mapped onto The Bob's grades. */
const MOOD = {
  day: "campusD",     // neutral daylight
  warm: "lawn",       // golden, soft
  cool: "campusS",    // cold, desaturated
  dim: "room",        // underexposed, moody
  night: "night",     // low blue ambient, warm practicals
  practical: "staff", // lit by an in-scene source
  moon: "campusN",    // hard blue key from a window
  bright: "campusD",  // high key (lifted below)
};

/** The grade for a baked shot: mood picks the preset, the scene palette name nudges it. */
export function gradeFor(shot, overrides = {}) {
  const base = GRADES[MOOD[shot?.light] ?? "campusD"];
  const g = { ...base, lift: [...base.lift], gain: [...base.gain], sh: [...base.sh], hi: [...base.hi] };
  if (shot?.light === "bright") { g.vig *= 0.5; g.con *= 0.75; g.key *= 1.5; g.bloom *= 1.3; }
  if (shot?.palette === "night" && shot?.light !== "night" && shot?.light !== "moon") { g.sat *= 0.9; g.key *= 0.6; g.vig = Math.max(g.vig, 0.55); }
  return Object.assign(g, overrides);
}
