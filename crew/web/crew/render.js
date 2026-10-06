// Wires the film look (render/look.js, a port of The Bob's pipeline) and the part renderer
// (render/encode.js) into the app: live viewer, quality tiers, render panel, stills.
import * as Look from "./render/look.js";
import * as Enc from "./render/encode.js";

const E = window.CrewExt;
const X = () => window.__crew;
const coarse = typeof matchMedia === "function" && matchMedia("(pointer:coarse)").matches;
const S = Look.settings;
if (S.quality == null) S.quality = coarse ? 0 : 1;
if (S.spp == null) S.spp = 1;

// The Bob's quality tiers: viewer resolution scale and depth-of-field taps (Draft, High, Ultra)
const TIERS = [{ pr: () => 0.85, dof: 12 }, { pr: (d) => Math.min(d || 1, 2), dof: 24 }, { pr: (d) => Math.min((d || 1) * 1.5, 3), dof: 36 }];
const live = new Set();
E.lookDefault = !coarse;

const isOn = () => X().store.get().look ?? E.lookDefault;
const tierOf = () => TIERS[Math.min(2, Math.max(0, S.quality | 0))];

E.look = {
  render: Look.render,
  renderAsync: Look.renderAsync,
  disposeLook: Look.disposeLook,
  infoAt: Look.infoAt,
  settings: S,
  /** the viewer's pixel ratio: The Bob's quality tier when the look is on, the app's own otherwise */
  pixelRatio: (viewer, dpr) => (viewer.liveLook && isOn() ? tierOf().pr(dpr) : null),
  dofTaps: (viewer) => (viewer.liveLook ? tierOf().dof : 36),
};

E.liveViewer = (v) => {
  v.liveLook = true;
  v.lookOn = isOn();
  live.add(v);
};
E.liveGone = (v) => live.delete(v);
E.lookChanged = () => { for (const v of live) v.redraw(); };

let last = { on: null, q: null };
function sync() {
  const st = X().store.get();
  const on = st.look ?? E.lookDefault, q = st.lookQ ?? S.quality;
  if (on === last.on && q === last.q) return;
  const qChanged = q !== last.q;
  last = { on, q };
  if (q !== S.quality) { S.quality = q; Look.saveSettings(); }
  for (const v of live) {
    v.lookOn = on;
    if (!on) Look.restoreSky(v);
    if (qChanged || on) { // pixel ratio follows the tier
      const c = v.canvas, r = c.getBoundingClientRect();
      if (r.width > 1) v.resize(r.width, r.height, window.devicePixelRatio || 1);
    }
    v.redraw();
  }
}
// the store exists once the app has mounted
const wait = setInterval(() => { if (X()?.store) { clearInterval(wait); X().store.subscribe(sync); sync(); } }, 100);

// ---- renders ------------------------------------------------------------------------------

/** Passes per frame, as in The Bob's render panel. */
E.render = {
  passes: [1, 4, 8, 16, 24, 32, 48, 96],
  get spp() { return S.spp; },
  setSpp(n) { S.spp = n; Look.saveSettings(); },
};

E.renderPart = (baked, range, opts, extra) => Enc.renderPart(baked, range, { ...opts, passes: opts.passes ?? S.spp }, extra);
E.webCodecs = Enc.webCodecsOk;
E.on("Focus pulls", ({ shot, focusAt, pullTo }) => {
  S.focus = { ...(S.focus ?? {}), [shot.id]: { at: focusAt, to: pullTo } };
  Look.saveSettings();
  X().toast(`Focus on ${shot.id}: ${focusAt === "auto" ? "first subject" : focusAt}${pullTo && pullTo !== "none" ? ` pulling to ${pullTo}` : ""}. Turn Depth of field on to see it.`);
  X().store.set({ lookRev: (X().store.get().lookRev ?? 0) + 1 });
  for (const v of live) v.redraw();
});
E.wired("Depth of field");
