// The Create page: branding (logo, name cards), thumbnails, fit to length, starter episodes,
// reframing, footage overlay and scene navigation. Nothing here browses the asset library.
import { baked, server, download, toast, esc, projectName, episodeName } from "./exports/util.js";
import { stillViewer, drawFrame, toBlob } from "./exports/media.js";

const E = window.CrewExt;
const X = () => window.__crew;
const LS = "crew.create.v1";
const load = () => { try { return JSON.parse(localStorage.getItem(LS) ?? "{}"); } catch { return {}; } };
const save = (o) => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch {} };
const saved = load();

// ---- branding: logo and name cards, drawn on renders and frames ---------------------------------------

export const brand = { on: false, img: null, logoName: "", names: !!saved.names };
E.brand = { ...brand, state: brand, set(o) { Object.assign(brand, o); save({ ...load(), names: brand.names }); } };

/** First time each character is on screen (cut time), from the baked frames. */
function firstSeen(b) {
  if (b._first) return b._first;
  const first = {};
  for (const s of b.shots) for (const [id, fr] of Object.entries(s.chars ?? {})) {
    if (id in first) continue;
    const k = fr.findIndex((f) => f[0]);
    if (k >= 0) first[id] = s.cutStart + k / b.fps;
  }
  return (b._first = first);
}

const ease = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

/** Called by the renderer and the frame exports after each frame is drawn. */
E.overlay = (g, W, H, t, b) => {
  if (brand.names) {
    const first = firstSeen(b), HOLD = 2.8, FADE = 0.35;
    for (const [id, t0] of Object.entries(first)) {
      const u = t - t0;
      if (u < 0 || u > HOLD + FADE) continue;
      const a = ease(u / FADE) * (1 - ease((u - HOLD) / FADE)), c = b.cast?.[id], name = c?.name ?? id;
      const size = Math.round(H * 0.045), x = Math.round(W * 0.05), y = Math.round(H * 0.82 + (1 - ease(u / FADE)) * H * 0.02);
      g.save(); g.globalAlpha = a; g.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
      const w = g.measureText(name).width + size * 1.4;
      g.fillStyle = "rgba(8,9,13,0.78)"; g.beginPath(); (g.roundRect ?? g.rect).call(g, x, y, w, size * 1.7, size * 0.25); g.fill();
      g.fillStyle = c?.color && /^#/.test(c.color) ? c.color : "#f59a40"; g.fillRect(x, y, size * 0.18, size * 1.7);
      g.fillStyle = "#fff"; g.textBaseline = "middle"; g.fillText(name, x + size * 0.6, y + size * 0.85);
      g.restore();
    }
  }
  if (brand.on && brand.img) {
    const lw = Math.round(W * 0.12), lh = Math.round((lw * brand.img.height) / brand.img.width);
    g.save(); g.globalAlpha = 0.92; g.drawImage(brand.img, W - lw - Math.round(W * 0.03), H - lh - Math.round(W * 0.03), lw, lh); g.restore();
  }
};

E.on("Placing your logo on renders", async ({ file }) => {
  if (!file) return;
  brand.img = await createImageBitmap(file);
  brand.logoName = file.name;
  toast(`Logo "${file.name}" loaded. Tick "Add my logo and colours to renders" to put it in the corner of renders and frames.`);
});

E.on("Lower-third title cards", () => {
  brand.names = !brand.names;
  save({ ...load(), names: brand.names });
  toast(brand.names ? "Name cards on: each character gets a lower third the first time they appear, in renders and frames." : "Name cards off.");
});

// ---- reframing --------------------------------------------------------------------------------------

E.reframeCfg = saved.reframe ?? { mode: "auto", crop: 0 };
E.on("Auto-reframing every shot", ({ mode = "auto", crop = 0 }) => {
  E.reframeCfg = { mode, crop };
  save({ ...load(), reframe: E.reframeCfg });
  toast(mode === "manual"
    ? `Narrow sizes (9:16, 1:1, 4:5) use your crop position (${crop.toFixed(2)}) on every shot.`
    : "Narrow sizes (9:16, 1:1, 4:5) now follow the subject in every shot. Render them from Create > Sizes.");
});

// ---- thumbnail --------------------------------------------------------------------------------------

const RANK = { ECU: 0, CU: 1, MCU: 2, MS: 3, OTS: 4, TWO: 5, MWS: 6, WS: 7, EWS: 8 };
function bestThumbTime(b) {
  let best = null;
  for (const s of b.shots) { const r = RANK[s.type] ?? 5; if (!best || r < best.r) best = { r, t: s.cutStart + s.cutDur * 0.6 }; }
  return best?.t ?? b.duration / 2;
}

function drawTitle(g, w, h, text) {
  if (!text) return;
  const lines = text.toUpperCase().split(/\n| \/ /).slice(0, 3), size = Math.round(h * (lines.length > 2 ? 0.12 : 0.16));
  g.save(); g.font = `800 ${size}px ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif`; g.textBaseline = "top"; g.lineJoin = "round";
  const x = Math.round(w * 0.05); let y = Math.round(h * 0.08);
  for (const ln of lines) {
    g.lineWidth = size * 0.16; g.strokeStyle = "#000"; g.strokeText(ln, x, y);
    g.fillStyle = "#fff"; g.fillText(ln, x, y); y += size * 1.05;
  }
  g.fillStyle = "#f59a40"; g.fillRect(x, y + size * 0.1, Math.round(w * 0.12), Math.round(h * 0.012));
  g.restore();
}

E.on("The thumbnail maker", async () => {
  const b = baked();
  let t = bestThumbTime(b), text = server().title ?? "";
  const pv = await stillViewer(640, 360, { look: true, spp: 1 });
  const host = document.createElement("div");
  host.innerHTML = `<div style="position:fixed;inset:0;background:#000b;z-index:99999;display:grid;place-items:center"><div style="background:#12141b;color:#e8e8ee;border:1px solid #333;border-radius:12px;padding:16px;width:min(700px,94vw);font:13px system-ui">
    <h3 style="margin:0 0 8px">Thumbnail</h3><canvas id="th-c" width="640" height="360" style="width:100%;border-radius:8px;background:#000"></canvas>
    <label style="display:block;margin:10px 0 2px;color:#9aa">Frame (${b.duration.toFixed(1)}s film)</label><input id="th-t" type="range" min="0" max="${b.duration.toFixed(2)}" step="0.04" value="${t.toFixed(2)}" style="width:100%">
    <label style="display:block;margin:8px 0 2px;color:#9aa">Words (a new line or " / " starts the next line)</label><input id="th-x" value="${esc(text)}" style="width:100%;padding:6px;background:#0b0c10;color:#fff;border:1px solid #333;border-radius:6px">
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button id="th-x1" style="padding:6px 12px">Close</button><button id="th-go" style="padding:6px 14px;background:#f59a40;border:0;border-radius:6px">Save 1280 × 720 PNG</button></div></div></div>`;
  document.body.appendChild(host);
  const canvas = host.querySelector("#th-c"), g = canvas.getContext("2d");
  let busy = false, again = false;
  const redraw = () => {
    if (busy) { again = true; return; }
    busy = true;
    try { g.drawImage(drawFrame(pv, t), 0, 0); drawTitle(g, 640, 360, text); } finally { busy = false; if (again) { again = false; redraw(); } }
  };
  redraw();
  host.querySelector("#th-t").oninput = (e) => { t = Number(e.target.value); redraw(); };
  host.querySelector("#th-x").oninput = (e) => { text = e.target.value; redraw(); };
  const close = () => { pv.dispose(true); host.remove(); };
  host.querySelector("#th-x1").onclick = close;
  host.querySelector("#th-go").onclick = async () => {
    const v = await stillViewer(1280, 720, { look: true, spp: 8 });
    try {
      const out = drawFrame(v, t), og = out.getContext("2d");
      drawTitle(og, 1280, 720, text);
      download(`${projectName()}_${episodeName()}_thumbnail.png`, await toBlob(out));
      toast("Thumbnail saved (1280 × 720, 8 passes).");
    } finally { v.dispose(true); }
    close();
  };
});

// ---- fit to length ----------------------------------------------------------------------------------

E.on("Fitting the cut to a target length", async ({ target }) => {
  const b = baked(), cur = b.duration;
  if (Math.abs(cur - target) / target < 0.03) { toast(`The cut is ${cur.toFixed(0)}s already; that's within 3% of ${target}s.`); return; }
  const note = cur > target
    ? `Tighten the whole cut and lose the dead air so it runs about ${target} seconds (it is ${cur.toFixed(0)} now)`
    : `Let the shots breathe: hold every shot a little longer so the cut runs about ${target} seconds (it is ${cur.toFixed(0)} now)`;
  await X().api.note(note);
  X().go("review");
  toast(`Sent to the crew as a note (${cur.toFixed(0)}s to ${target}s). Pick a take under Notes.`);
});

// ---- starter episodes (from the show's own sets and cast) ------------------------------------------------

/** SCENE text for a starter format, built from whatever sets and characters this show already has. */
export function starterEpisode(kind, b, title) {
  const setId = Object.keys(b.sets)[0], set = b.sets[setId], cast = Object.keys(b.cast);
  if (!setId || !cast.length) throw new Error("This show has no set or cast yet; a starter needs both.");
  const a = cast[0], c = cast[1] ?? cast[0], anchors = (set.anchors ?? []).filter((x) => x.furniture !== "door" && x.furniture !== "window").map((x) => x.id);
  const A = anchors[0] ?? "", C = anchors[1] ?? anchors[0] ?? "";
  const at = (id, anc) => (anc ? `${id}@${anc}` : id);
  const T = {
    explainer: [["1A WS", [`${at(a, A)} enter`, `${a} say "Hi, I'm ${b.cast[a].name}."`]], ["1B MCU " + a, [`${a} say "Today: ${title}."`, `${a} smile ~1`]], ["1C CU " + a, [`${a} say "Here's the idea in one minute."`]], ["1D MS " + a, [`${a} point ~0.8`, `${a} say "Let's get into it."`]]],
    podcast: [["1A WS", [`${at(a, A)} enter`, `with ${at(c, C)} enter`, `${a} say "Welcome back."`]], [`1B OTS ${a}>${c}`, [`${c} say "Glad to be here."`]], [`1C OTS ${c}>${a}`, [`${a} say "Tell me how it started."`, `${c} nod ~0.8`]], ["1D WS", [`${c} say "It started small."`, `${a} laugh ~1`]]],
    whiteboard: [["1A WS", [`${at(a, A)} enter`, `${a} say "Three steps."`]], ["1B MS " + a, [`${a} point ~0.8`, `${a} say "First, the problem."`]], ["1C MS " + a, [`${a} point ~0.8`, `${a} say "Then the fix."`]], ["1D MCU " + a, [`${a} smile ~1`, `${a} say "That's all there is to it."`]]],
    recon: [["1A EWS", [`${at(a, A)} enter`, "ambience night"]], ["1B MWS " + a, [`${a} walk ${C || a} 0.9`]], ["1C MCU " + a, [`${a} think ~2`, "with sfx footsteps"]], ["1D CU " + a, [`${a} shock ~1.5`]]],
    reaction: [["1A MCU " + a, [`${at(a, A)} enter`, `${a} neutral ~1`]], ["1B CU " + a, [`${a} shock ~1.2`]], ["1C CU " + a, [`${a} laugh ~1.6`]], ["1D MCU " + a, [`${a} sigh ~1`]]],
    intro: [["1A EWS", ["ambience day", "music sting"]], ["1B MS " + a, [`${at(a, A)} enter`, `${a} wave ~1`, `${a} say "Welcome to ${title}."`]], ["1C CU " + a, [`${a} smile ~1.5`]]],
    sponsor: [["1A MS " + a, [`${at(a, A)} enter`, `${a} say "This episode is brought to you by someone great."`]], ["1B MCU " + a, [`${a} smile ~1`, `${a} say "Use the link below."`]], ["1C WS", [`${a} wave ~1`]]],
  };
  const shots = T[kind];
  if (!shots) throw new Error(`No starter called ${kind}.`);
  return [`episode 1 "${title.replace(/"/g, "'")}"`, "", `scene 1 ${setId} day act 1`, ...shots.flatMap(([h, body]) => [h, ...body.map((l) => "  " + l)])].join("\n") + "\n";
}

const TITLES = { explainer: "Explainer", podcast: "Two people talking", whiteboard: "Whiteboard walk-through", recon: "Reconstruction", reaction: "Reaction", intro: "Channel intro", sponsor: "Sponsor read" };
E.on("Starting from a template", async ({ template }) => {
  const b = baked(), text = starterEpisode(template, b, TITLES[template] ?? "Untitled");
  if (!window.confirm(`Replace the current episode with a "${TITLES[template]}" starter built from this show's own set and cast? You can undo it.`)) return;
  const r = await X().api.putEpisode(text);
  const errs = (r.grammar?.errors ?? r.grammar ?? []).filter?.((i) => i.severity === "error") ?? [];
  X().go("review");
  toast(errs.length ? `Starter loaded with ${errs.length} problem${errs.length > 1 ? "s" : ""} to fix (see QC).` : "Starter loaded. Change it with notes.");
});

// ---- scenes: jump around the show's own episode ------------------------------------------------------------

E.on("The scene library", () => {
  const b = baked(), scenes = new Map();
  for (const s of b.shots) { const e = scenes.get(s.scene) ?? { n: s.scene, set: s.set, t: s.cutStart, shots: 0, dur: 0 }; e.shots++; e.dur += s.cutDur; scenes.set(s.scene, e); }
  const host = document.createElement("div");
  host.innerHTML = `<div style="position:fixed;inset:0;background:#000b;z-index:99999;display:grid;place-items:center"><div style="background:#12141b;color:#e8e8ee;border:1px solid #333;border-radius:12px;padding:16px;width:min(460px,92vw);font:13px system-ui">
    <h3 style="margin:0 0 8px">Scenes in this episode</h3>${[...scenes.values()].map((s) => `<button data-t="${s.t}" style="display:block;width:100%;text-align:left;margin:4px 0;padding:8px 10px;background:#1b1e27;border:1px solid #2a2d38;border-radius:8px;color:inherit">Scene ${s.n} · ${esc(s.set)} <span style="color:#9aa;float:right">${s.shots} shots · ${s.dur.toFixed(1)}s</span></button>`).join("")}
    <div style="text-align:right;margin-top:8px"><button id="sc-x" style="padding:6px 12px">Close</button></div></div></div>`;
  document.body.appendChild(host);
  host.onclick = (e) => {
    const t = e.target.closest("[data-t]");
    if (t) { X().go("review"); X().clock.seek(Number(t.dataset.t)); host.remove(); }
    else if (e.target.id === "sc-x") host.remove();
  };
});

// ---- footage over the previs ------------------------------------------------------------------------------

let overlayVideo = null;
E.on("Syncing footage over the previs", ({ file }) => {
  if (!file) return;
  overlayVideo?.remove();
  const vp = [...document.querySelectorAll("canvas")].filter((c) => c.getBoundingClientRect().width > 300).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  if (!vp) throw new Error("Open the Review page first, so there's a viewer to lay the footage over.");
  const box = document.createElement("div"), v = document.createElement("video");
  v.src = URL.createObjectURL(file); v.muted = true; v.playsInline = true; v.style.cssText = "width:100%;height:100%;object-fit:contain;opacity:.5;pointer-events:none";
  box.style.cssText = "position:fixed;z-index:9000;pointer-events:none";
  box.innerHTML = `<button style="position:absolute;right:6px;top:6px;pointer-events:auto;padding:4px 8px;background:#000a;color:#fff;border:1px solid #555;border-radius:6px">Remove footage</button>`;
  box.prepend(v); document.body.appendChild(box); overlayVideo = box;
  const place = () => { const r = vp.getBoundingClientRect(); Object.assign(box.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" }); };
  const tick = setInterval(() => {
    if (!box.isConnected) return clearInterval(tick);
    place();
    const c = X().clock;
    if (Math.abs(v.currentTime - c.t) > 0.15) v.currentTime = c.t;
    if (c.playing && v.paused) v.play().catch(() => {}); else if (!c.playing && !v.paused) v.pause();
  }, 100);
  box.querySelector("button").onclick = () => { clearInterval(tick); URL.revokeObjectURL(v.src); box.remove(); overlayVideo = null; };
  toast(`Footage "${file.name}" is laid over the viewer at half strength and follows the playhead. It stays on this machine.`);
});

E.wired("Start from a template", "Thumbnail", "Your brand", "Camera body", "Vertical 9:16");
