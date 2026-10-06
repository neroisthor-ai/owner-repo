// Crew style (real numbers from the notes and the cut), reference scenes, retiming beats by dragging,
// and honest answers for what a one-show local server can't do (review links, project management).
import { baked, server, toast, esc } from "./exports/util.js";

const E = window.CrewExt;
const X = () => window.__crew;
const LS = "crew.style.v1";
const state = (() => { try { return JSON.parse(localStorage.getItem(LS) ?? "{}"); } catch { return {}; } })();
const persist = () => { try { localStorage.setItem(LS, JSON.stringify(state)); } catch {} };
const STOP = new Set("the a an to of and in on at it is for with more less so that this by as be into than then from up down make makes made take takes shot shots cut cuts line lines".split(" "));

const top = (texts, n = 3) => {
  const c = new Map();
  for (const t of texts) for (const w of String(t).toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []) if (!STOP.has(w)) c.set(w, (c.get(w) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).filter(([, k]) => k >= 1).map(([w]) => w);
};

/** What the notes and the cut say about how this director works. */
function rows(sv) {
  const b = sv?.baked;
  const notes = (sv?.notes ?? []).filter((n) => (n.at ?? 0) >= (state.resetAt ?? 0) || !n.at);
  const accepted = notes.filter((n) => n.status === "accepted" && n.accepted), rejected = notes.filter((n) => n.status === "rejected");
  const purposes = (ns, pick) => ns.flatMap((n) => n.takes.filter((t) => pick(n, t)).map((t) => t.purpose));
  const fav = top(purposes(accepted, (n, t) => t.id === n.accepted)), avoid = top([...purposes(rejected, () => true), ...purposes(accepted, (n, t) => t.id !== n.accepted)]);
  const asl = b?.shots?.length ? b.shots.reduce((a, s) => a + s.cutDur, 0) / b.shots.length : null;
  const types = {};
  for (const s of b?.shots ?? []) types[s.type] = (types[s.type] ?? 0) + 1;
  const common = Object.entries(types).sort((a, c) => c[1] - a[1]).slice(0, 2).map(([k]) => k).join(", ");
  const closed = accepted.length + rejected.length;
  const out = [
    ["Cuts every", asl ? `${asl.toFixed(1)} s on average (${b.shots.length} shots)` : "no shots yet"],
    ["Shoots mostly", common || "no shots yet"],
    ["Takes accepted", closed ? `${accepted.length} of ${closed} notes (${Math.round((accepted.length / closed) * 100)}%)` : "none yet"],
    ["Favours", fav.length ? fav.join(", ") : "nothing yet"],
    ["Avoids", avoid.length ? avoid.join(", ") : "nothing yet"],
  ];
  if (state.ref) out.push(["Reference", state.ref]);
  return { rows: out, note: closed ? `Learned from ${closed} note${closed > 1 ? "s" : ""}${state.resetAt ? " since you reset" : ""}. Favours and avoids are the words in the takes you accepted and rejected.` : "Nothing learned yet. Accept or reject a take and it shows up here." };
}
E.style = { rows };

E.on("Resetting the crew's style", () => {
  state.resetAt = Date.now(); state.ref = null; persist();
  X().store.set({ styleRev: (X().store.get().styleRev ?? 0) + 1 });
  toast("Style view reset. The notes themselves stay in the project (the crew still reads them), only this summary starts again.");
});

// ---- reference scene: how fast does it cut? ----------------------------------------------------------

E.on("Learning from a reference scene", async ({ file }) => {
  if (!file) return;
  const v = document.createElement("video");
  v.muted = true; v.preload = "auto"; v.src = URL.createObjectURL(file);
  await new Promise((ok, fail) => { v.onloadedmetadata = ok; v.onerror = () => fail(new Error("The browser can't read that video.")); });
  const dur = Math.min(v.duration, 300), step = 0.2, W = 32, H = 18, c = document.createElement("canvas"), g = c.getContext("2d", { willReadFrequently: true });
  c.width = W; c.height = H;
  let prev = null, cuts = 0;
  const diffs = [];
  toast(`Reading "${file.name}" for cuts...`);
  for (let t = 0; t < dur; t += step) {
    v.currentTime = t;
    await new Promise((ok) => { v.onseeked = ok; });
    g.drawImage(v, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    if (prev) { let s = 0; for (let i = 0; i < d.length; i += 4) s += Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]) + Math.abs(d[i + 2] - prev[i + 2]); diffs.push(s / (W * H * 3)); }
    prev = d.slice();
  }
  URL.revokeObjectURL(v.src);
  const mean = diffs.reduce((a, x) => a + x, 0) / Math.max(1, diffs.length), sd = Math.sqrt(diffs.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, diffs.length));
  const th = Math.max(18, mean + 3 * sd);
  let last = -1;
  diffs.forEach((x, i) => { if (x > th && i - last > 2) { cuts++; last = i; } });
  const asl = cuts ? dur / (cuts + 1) : dur;
  state.ref = `${file.name.slice(0, 24)}: a cut about every ${asl.toFixed(1)} s (${cuts} cuts in ${dur.toFixed(0)} s)`;
  persist();
  X().store.set({ styleRev: (X().store.get().styleRev ?? 0) + 1 });
  const ours = rows(server()).rows[0][1];
  toast(`Reference cuts about every ${asl.toFixed(1)} s. Yours: ${ours}. Ask the crew to "tighten the cut" or "let it breathe" to move towards it.`);
});

// ---- retiming beats by dragging their right edge -------------------------------------------------------

function beatOf(addr) {
  for (const s of baked().shots) { const k = (s.beats ?? []).find((x) => x.addr === addr); if (k) return { shot: s, beat: k }; }
  return null;
}
let drag = null;
document.addEventListener("pointerdown", (e) => {
  const el = e.target?.closest?.("[data-beat]");
  if (!el || !/cursor-ew-resize/.test(el.className)) return;
  const r = el.getBoundingClientRect();
  if (e.clientX < r.right - Math.max(8, r.width * 0.4)) return; // grab the right edge
  const hit = beatOf(el.dataset.beat);
  if (!hit) return;
  const dur = hit.beat.t1 - hit.beat.t0;
  drag = { el, addr: el.dataset.beat, x0: e.clientX, w0: r.width, pps: (r.width + 1) / Math.max(0.05, dur), dur };
  el.setPointerCapture?.(e.pointerId);
  e.preventDefault(); e.stopPropagation();
}, true);
document.addEventListener("pointermove", (e) => { if (drag) drag.el.style.width = Math.max(4, drag.w0 + e.clientX - drag.x0) + "px"; }, true);
document.addEventListener("pointerup", async (e) => {
  if (!drag) return;
  const d = drag; drag = null;
  const nd = Math.max(0.1, Math.round((d.dur + (e.clientX - d.x0) / d.pps) * 10) / 10);
  if (Math.abs(nd - d.dur) < 0.05) { d.el.style.width = d.w0 + "px"; return; }
  try {
    const sv = server(), idx = sv.addresses.indexOf(d.addr);
    const line = sv.source.split("\n")[idx];
    if (idx < 0 || line == null) throw new Error("Can't find that line in the episode.");
    const fmt = (n) => String(Math.round(n * 100) / 100);
    const m = line.match(/~(\d+(?:\.\d+)?)/);
    const patch = m ? `${d.addr} ~${m[1]} -> ~${fmt(nd)}` : `${d.addr} = ${line.trim()} ~${fmt(nd)}`;
    const dry = await X().api.patch(patch, "director", true);
    if (!dry.ok) throw new Error(dry.reasons?.join("; ") ?? "the checks refused it");
    await X().api.patch(patch, "director", false);
    toast(`${d.addr}: ${d.dur.toFixed(1)}s to ${nd.toFixed(1)}s.`);
  } catch (err) { d.el.style.width = d.w0 + "px"; toast(`Retime refused: ${err.message}`, "error"); }
}, true);
E.on("Dragging beats to retime", () => toast("Drag the right edge of a beat on the Beats track. The change is checked before it applies."));

// ---- what a local, one-show server can't do ---------------------------------------------------------------

E.on("Creating a review link", () => toast("Review links need a hosted server; this one runs on your machine. Send the .json comments file instead (Share > Export), or the exported MP4."));
E.on("Switching projects", ({ project }) => toast(`This server has one show${project ? ` (${project.title})` : ""}. Start the server on another show folder to open it.`));
E.on("Renaming projects", () => toast("A project is named by its show file. Edit `show \"Title\"` in show.scene."));
E.on("Duplicating projects", () => toast("Copy the show folder to duplicate a project."));
E.on("Archiving projects", () => toast("Move the show folder out of your shows directory to archive it."));

E.wired("Crew style", "Hand off to editorial");
