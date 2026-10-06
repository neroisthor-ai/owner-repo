import { Player } from "./player.js";
import { LiveSound } from "./audio.js";
import { MasterRender } from "./export.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const api = async (path, body, method) => {
  const r = await fetch(path, body === undefined && !method ? undefined : { method: method ?? "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j;
};
const toast = (msg, err = false) => { const t = $("toast"); t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 4200); };
const tc = (t, fps = 24) => { const f = Math.round(t * fps); const s = Math.floor(f / fps); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}:${String(f % fps).padStart(2, "0")}`; };
const money = (v) => v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;

const player = new Player($("view"));
const sound = new LiveSound();
let S = null; // server state
let baked = null; // what the viewer is playing (current cut or a take preview)
let preview = null; // { note, take, changed }
let t = 0, playing = false, lastTick = 0;
let screening = null;

// ------------------------------------------------------------------ state
async function load(keepTime = true) {
  S = await api("/api/state");
  $("title").textContent = S.title;
  $("episode").textContent = `${S.episode} · ${S.baked.duration.toFixed(1)}s · ${S.baked.shots.length} shots`;
  $("mode").textContent = S.mode === "claude" ? "Claude crew" : "Offline crew";
  $("mode").className = "chip" + (S.mode === "claude" ? " claude" : "");
  $("pipeline").textContent = `${S.pipeline} pipeline`;
  const c = S.qc.counts;
  $("qcChip").textContent = c.error ? `${c.error} QC errors` : c.warn ? `${c.warn} QC warnings` : "QC clean";
  $("qcChip").className = "chip " + (c.error ? "err" : c.warn ? "" : "ok");
  $("qcCount").textContent = c.error || "";
  const m = S.metrics;
  $("rate").textContent = m.resolutionRate === null ? "resolution —" : `resolution ${Math.round(m.resolutionRate * 100)}% (${m.resolvedFirstRound}/${m.closed})`;
  $("cost").textContent = `${money(m.cost)} spent`;
  if (!preview) setBaked(S.baked, keepTime);
  renderScript(); renderQc(); renderNotes(); renderHistory();
}

function setBaked(b, keepTime = true) {
  baked = b;
  player.load(b);
  if (!keepTime) t = 0;
  t = Math.min(t, Math.max(0, b.duration - 1 / b.fps));
  renderTimeline();
  draw();
}

// ------------------------------------------------------------------ playback
function draw() {
  if (!baked) return;
  const r = player.frame(t);
  $("tc").textContent = tc(t, baked.fps);
  $("ovTime").textContent = tc(t, baked.fps);
  if (r) {
    const s = r.shot;
    $("ovShot").textContent = `${s.id}  ${s.label}  ${Math.round(s.lens)}mm  ${s.move}${s.move !== "static" ? "." + s.speed : ""}`;
    $("shotInfo").textContent = `${s.id} · frame ${r.frame + 1}/${s.cam.length} · ${s.light} light`;
    document.querySelectorAll(".shotblock").forEach((el) => el.classList.toggle("cur", el.dataset.id === s.id));
  }
  const line = baked.audio.find((e) => e.type === "say" && t >= e.t && t < e.t + e.dur + 0.15);
  $("ovSub").innerHTML = line ? `<b>${esc(baked.cast[line.char]?.name ?? line.char)}</b> ${esc(line.text)}` : "";
  $("playhead").style.left = `calc(8px + (100% - 16px) * ${t / baked.duration})`;
}

function loop(now) {
  if (!playing) return;
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  const from = t;
  t += dt;
  if (t >= baked.duration) { t = baked.duration - 1 / baked.fps; sound.tick(baked.audio, baked.cast, from, baked.duration); setPlaying(false); draw(); return; }
  sound.tick(baked.audio, baked.cast, from, t);
  draw();
  requestAnimationFrame(loop);
}

function setPlaying(p) {
  playing = p;
  $("play").textContent = p ? "❚❚" : "▶";
  if (p) { if (t >= baked.duration - 0.05) t = 0; sound.start(baked.audio, t); lastTick = performance.now(); requestAnimationFrame(loop); }
  else sound.stop();
}

function seek(nt, play = playing) {
  t = Math.max(0, Math.min(baked.duration - 1 / baked.fps, nt));
  if (playing) { sound.stop(); sound.start(baked.audio, t); }
  draw();
  if (play && !playing) setPlaying(true);
}

const shotIndexAt = (time) => { let i = 0; baked.shots.forEach((s, k) => { if (s.cutStart <= time + 1e-6) i = k; }); return i; };
const jumpShot = (d) => { const i = Math.max(0, Math.min(baked.shots.length - 1, shotIndexAt(t) + d)); seek(baked.shots[i].cutStart + 1e-3); };
const seekShot = (id, local = null) => { const s = baked.shots.find((x) => x.id === id); if (s) seek(s.cutStart + Math.max(0, (local ?? s.trimHead) - s.trimHead) + 1e-3); };

// ------------------------------------------------------------------ timeline
function renderTimeline() {
  const D = baked.duration, lane = $("laneShots");
  const pct = (x) => `${(x / D) * 100}%`;
  const changed = new Set(preview?.changed ?? []);
  lane.innerHTML = baked.shots.map((s) => `<div class="shotblock ${s.sceneIndex % 2 ? "s1" : ""} ${changed.has(s.id) ? "changed" : ""}" data-id="${s.id}" style="left:${pct(s.cutStart)};width:calc(${pct(s.cutDur)} - 2px)" title="${esc(s.id)} ${esc(s.label)} · ${s.cutDur.toFixed(1)}s · hash ${s.hash}">${esc(s.id)}<span class="lbl">${esc(s.label)}</span></div>`).join("");
  if (!preview && S) {
    for (const i of S.qc.issues) {
      const s = baked.shots.find((x) => x.id === i.shot);
      if (!s) continue;
      const at = s.cutStart + Math.max(0, Math.min(s.cutDur, (i.local ?? s.trimHead) - s.trimHead));
      lane.insertAdjacentHTML("beforeend", `<span class="mark ${i.severity}" style="left:${pct(at)}" title="${esc(i.message)}"></span>`);
    }
  }
  const castIds = Object.keys(baked.cast);
  $("laneAudio").innerHTML = baked.audio.map((e) => {
    if (e.type === "say") return `<span class="aud" style="left:${pct(e.t)};width:${pct(e.dur)};background:${baked.cast[e.char]?.color ?? "#888"}" title="${esc(e.char)}: ${esc(e.text)}"></span>`;
    if (e.type === "sfx") return `<span class="aud sfx" style="left:${pct(e.t)}" title="sfx ${esc(e.name)}"></span>`;
    return "";
  }).join("") + musicBars(pct, D);
  void castIds;
  const heat = $("laneHeat");
  if (screening && !preview) {
    heat.hidden = false;
    heat.innerHTML = screening.shots.map((r) => {
      const s = baked.shots.find((x) => x.id === r.id);
      if (!s) return "";
      const v = Math.max(r.boredom, r.confusion) / 3;
      const col = r.confusion >= r.boredom ? `rgba(106,168,255,${0.15 + v * 0.85})` : `rgba(255,93,93,${0.15 + v * 0.85})`;
      return `<span class="heatcell" style="left:${pct(s.cutStart)};width:${pct(s.cutDur)};background:${col}" title="${s.id}: confusion ${r.confusion}, boredom ${r.boredom}${r.notes.length ? " · " + esc(r.notes.join(" | ")) : ""}"></span>`;
    }).join("");
  } else heat.hidden = true;
}

function musicBars(pct, D) {
  let out = "", cur = null, from = 0;
  for (const e of [...baked.audio.filter((x) => x.type === "music"), { t: D, name: "stop" }]) {
    if (cur && e.t > from) out += `<span class="aud music" style="left:${pct(from)};width:${pct(e.t - from)}" title="music ${esc(cur)}"></span>`;
    cur = e.name === "stop" ? null : e.name; from = e.t;
  }
  return out;
}

let scrubbing = false;
const scrubTo = (ev) => { const r = $("laneShots").getBoundingClientRect(); seek(((ev.clientX - r.left) / r.width) * baked.duration, false); };
$("timeline").addEventListener("pointerdown", (ev) => { scrubbing = true; $("timeline").setPointerCapture(ev.pointerId); if (playing) setPlaying(false); scrubTo(ev); });
$("timeline").addEventListener("pointermove", (ev) => { if (scrubbing) scrubTo(ev); });
$("timeline").addEventListener("pointerup", () => { scrubbing = false; });

// ------------------------------------------------------------------ notes
const EXAMPLES = ["1A, kiran clips mum", "1D is too long", "1C: I want to be inside her head", "play 1E from kiran's side", "1G bring in tense music"];
$("examples").innerHTML = EXAMPLES.map((e) => `<button type="button">${esc(e)}</button>`).join("");
$("examples").addEventListener("click", (ev) => { if (ev.target.tagName === "BUTTON") { $("noteInput").value = ev.target.textContent; $("noteInput").focus(); } });
$("noteInput").addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); $("noteForm").requestSubmit(); } });

let followUp = null;
$("noteForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const note = $("noteInput").value.trim();
  if (!note) return;
  $("noteSend").disabled = true;
  $("noteResult").innerHTML = `<div class="result"><span class="spin"></span> The crew is on it… <span class="dim">(watch the Crew tab)</span></div>`;
  try {
    const rec = await api("/api/note", { note, parent: followUp ?? undefined });
    followUp = null;
    $("noteInput").value = "";
    showNote(rec);
    await load();
    if (rec.takes[0]) previewTake(rec, rec.takes[0], true);
  } catch (e) { $("noteResult").innerHTML = `<div class="result err">${esc(e.message)}</div>`; }
  $("noteSend").disabled = false;
});

let shownNote = null;
function showNote(n) {
  shownNote = n;
  const letters = "ABC";
  const takes = n.takes.map((tk, i) => `
    <div class="take ${i === 0 ? "rec" : ""}" data-take="${tk.id}">
      <div class="head"><span class="letter">${letters[i]}</span><div class="purpose">${esc(tk.purpose)}</div></div>
      <pre>${esc(tk.patch)}</pre>
      <div class="tags">
        ${tk.changedShots.map((s) => `<span class="tag">renders ${esc(s)}</span>`).join("")}
        ${tk.fixed.map((f) => `<span class="tag fix" title="${esc(f)}">fixes: ${esc(f.length > 42 ? f.slice(0, 40) + "…" : f)}</span>`).join("")}
        ${tk.added.map((f) => `<span class="tag new" title="${esc(f)}">new: ${esc(f.length > 42 ? f.slice(0, 40) + "…" : f)}</span>`).join("")}
        <span class="tag tier-${esc(tk.tier)}">${esc(tk.tier)}</span>
      </div>
      ${n.status === "open" ? `<div class="row"><button class="btn" data-act="preview">Preview</button><button class="btn primary" data-act="accept">Accept</button></div>` : ""}
    </div>`).join("");
  $("noteResult").innerHTML = `<div class="result">
    <div class="meta"><span>${esc(n.roles.join(" + "))} → ${esc(n.targets.join(", ") || "?")}</span><span>${n.mode}</span><span>${money(n.cost)}</span><span>${(n.ms / 1000).toFixed(1)}s</span>${n.round > 1 ? `<span>round ${n.round}</span>` : ""}</div>
    <div class="msg">${esc(n.message)}</div>
    ${n.pushback ? `<div class="callout push"><b>Pushback</b>${esc(n.pushback)}</div>` : ""}
    ${takes}
    ${n.idea ? `<div class="callout idea"><b>One idea you didn't ask for</b>${esc(n.idea)}</div>` : ""}
    ${n.status === "open" && n.takes.length ? `<div class="row"><button class="btn ghost" data-act="reject">None of these</button><button class="btn ghost" data-act="again">Try again with a note…</button></div>` : ""}
    ${!n.takes.length && n.rejected.length ? `<details class="section"><summary>${n.rejected.length} rejected candidates</summary><pre class="code">${esc(n.rejected.slice(0, 12).map((r) => `[${r.tier}] ${r.reason}`).join("\n"))}</pre></details>` : ""}
  </div>`;
}

$("noteResult").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-act]");
  if (!btn || !shownNote) return;
  const takeId = btn.closest("[data-take]")?.dataset.take;
  const take = shownNote.takes.find((x) => x.id === takeId);
  try {
    if (btn.dataset.act === "preview") await previewTake(shownNote, take, true);
    if (btn.dataset.act === "accept") await acceptTake(shownNote, take);
    if (btn.dataset.act === "reject") { await api("/api/reject", { noteId: shownNote.id }); exitPreview(); toast("Rejected. The crew will remember."); await load(); showNote({ ...shownNote, status: "rejected" }); }
    if (btn.dataset.act === "again") { followUp = shownNote.id; exitPreview(); $("noteInput").placeholder = `Follow-up on "${shownNote.note}"…`; $("noteInput").focus(); }
  } catch (e) { toast(e.message, true); }
});

async function previewTake(n, tk, play) {
  const p = await api(`/api/preview?note=${encodeURIComponent(n.id)}&take=${encodeURIComponent(tk.id)}`);
  preview = { note: n, take: tk, changed: p.changedShots };
  const letter = "ABC"[n.takes.indexOf(tk)];
  $("ovPreview").hidden = false;
  $("ovPreview").textContent = `PREVIEW · TAKE ${letter} · ${p.changedShots.join(", ")}  (Esc for the current cut)`;
  document.querySelectorAll(".take").forEach((el) => el.style.outline = el.dataset.take === tk.id ? "1px solid var(--accent)" : "");
  setBaked(p.baked);
  const first = p.baked.shots.find((s) => p.changedShots.includes(s.id));
  if (first) {
    const prev = p.baked.shots[Math.max(0, p.baked.shots.indexOf(first) - 1)];
    seek(prev === first ? first.cutStart : Math.max(prev.cutStart, first.cutStart - 1.0), play);
  }
}

function exitPreview() {
  if (!preview) return;
  preview = null;
  $("ovPreview").hidden = true;
  document.querySelectorAll(".take").forEach((el) => el.style.outline = "");
  if (S) setBaked(S.baked);
}

async function acceptTake(n, tk) {
  await api("/api/accept", { noteId: n.id, takeId: tk.id });
  preview = null;
  $("ovPreview").hidden = true;
  toast(`Applied: ${tk.purpose}`);
  await load();
  showNote({ ...n, status: "accepted", accepted: tk.id, takes: [tk] });
  const s = baked.shots.find((x) => tk.changedShots.includes(x.id));
  if (s) seek(s.cutStart, true);
}

function renderNotes() {
  $("noteList").innerHTML = S.notes.map((n) => `
    <div class="item click" data-note="${n.id}">
      <span class="status ${n.status}">${n.status}</span>
      <div class="grow">${esc(n.note)}<div class="dim small">${esc(n.roles.join("+"))} · ${n.takes.length} takes · ${money(n.cost)}${n.rating ? ` · rated ${n.rating}` : ""}</div></div>
      ${n.status === "accepted" && !n.rating ? `<button class="btn ghost small" data-rate="better" title="Blind check: is the cut better?">👍</button><button class="btn ghost small" data-rate="worse">👎</button>` : ""}
    </div>`).join("") || `<div class="dim">No notes yet. Try one of the examples above.</div>`;
}
$("noteList").addEventListener("click", async (ev) => {
  const item = ev.target.closest("[data-note]");
  if (!item) return;
  const n = S.notes.find((x) => x.id === item.dataset.note);
  const rate = ev.target.closest("[data-rate]")?.dataset.rate;
  if (rate) { await api("/api/rate", { noteId: n.id, rating: rate }); toast("Thanks. Ratings feed the resolution rate."); return load(); }
  exitPreview();
  showNote(n);
});

// ------------------------------------------------------------------ script & patch
function renderScript() {
  if (document.activeElement !== $("source")) $("source").value = S.source;
  const n = $("source").value.split("\n").length;
  const addr = S.addresses;
  $("gutter").textContent = Array.from({ length: n }, (_, i) => addr[i] ?? "").join("\n");
  $("source").rows = n + 1;
  const errs = new Set(S.grammar.map((g) => g.line));
  $("gutter").innerHTML = Array.from({ length: n }, (_, i) => errs.has(i + 1) ? `<span style="color:var(--err)">✕ ${esc(addr[i] ?? "")}</span>` : esc(addr[i] ?? "")).join("\n");
  $("bible").textContent = S.showSource;
}
$("source").addEventListener("input", () => { $("source").rows = $("source").value.split("\n").length + 1; });
$("saveSource").addEventListener("click", async () => {
  try { const r = await api("/api/episode", { source: $("source").value }, "PUT"); toast(r.grammar.length ? `Saved with ${r.grammar.length} grammar errors (see QC)` : "Saved"); $("source").blur(); await load(); } catch (e) { toast(e.message, true); }
});
const runPatch = async (dryRun) => {
  try {
    const r = await api("/api/patch", { patch: $("patchText").value, role: $("patchRole").value, dryRun });
    const lines = [r.ok ? (r.committed ? "APPLIED" : "PASSES (dry run)") : "REJECTED", ...r.reasons.map((x) => "  - " + x), ...r.changes.map((c) => `  ${c.addr}: ${c.before ?? "(new)"} -> ${c.after ?? "(deleted)"}`)];
    if (r.changedShots.length) lines.push(`renders differently: ${r.changedShots.join(", ")}`);
    if (r.fixedIssues.length) lines.push(...r.fixedIssues.map((i) => "  fixed: " + i.message));
    if (r.newIssues.length) lines.push(...r.newIssues.map((i) => `  new ${i.severity}: ${i.message}`));
    $("patchOut").hidden = false; $("patchOut").textContent = lines.join("\n");
    if (r.committed) await load();
  } catch (e) { toast(e.message, true); }
};
$("patchDry").addEventListener("click", () => runPatch(true));
$("patchApply").addEventListener("click", () => runPatch(false));

// ------------------------------------------------------------------ QC & screening
function renderQc() {
  const q = S.qc;
  $("qcSummary").innerHTML = `<span class="chip ${q.counts.error ? "err" : ""}">${q.counts.error} errors</span><span class="chip">${q.counts.warn} warnings</span><span class="chip">${q.counts.info} notes</span>`;
  $("qcList").innerHTML = q.issues.map((i, k) => `<div class="item click" data-k="${k}"><span class="sev ${i.severity}"></span><div class="grow">${esc(i.message)}<div class="dim small">${esc(i.check)} · ${esc(i.addr ?? "episode")}${i.local !== undefined ? ` @${i.local}s` : ""}</div></div></div>`).join("") || `<div class="dim">Every code check passes.</div>`;
  $("qcScope").innerHTML = `<p class="small"><b>Checked:</b> ${q.checked.map(esc).join("; ")}</p><p class="small"><b>Not checked:</b> ${q.notChecked.map(esc).join("; ")}</p>`;
}
$("qcList").addEventListener("click", (ev) => { const k = ev.target.closest("[data-k]")?.dataset.k; if (k === undefined) return; const i = S.qc.issues[k]; exitPreview(); if (i.shot) seekShot(i.shot, i.local ?? null); });
$("screen").addEventListener("click", async () => {
  $("screen").disabled = true;
  $("screenOut").innerHTML = `<p><span class="spin"></span> Screening…</p>`;
  try {
    screening = await api("/api/screen", { viewers: 5 });
    $("screenOut").innerHTML = `<p><b>${Math.round(screening.understoodShare * 100)}%</b> could say what the character wants <span class="dim">(${screening.mode}, ${money(screening.cost)})</span></p>` +
      screening.viewers.map((v) => `<div class="item"><span class="status ${v.understood ? "accepted" : "rejected"}">${v.understood ? "got it" : "lost"}</span><div class="grow small">${esc(v.wants)}<div class="dim">${esc(v.persona)}</div></div></div>`).join("") +
      `<p class="dim small">Heatmap added under the timeline: red = bored, blue = confused.</p>`;
    renderTimeline();
  } catch (e) { $("screenOut").textContent = e.message; }
  $("screen").disabled = false;
});

// ------------------------------------------------------------------ crew log & history
const logRow = (e) => {
  const div = document.createElement("div");
  div.innerHTML = `<span class="tier ${esc(e.tier ?? "")}">${esc(e.tier ?? "·")}</span> <b>${esc(e.role ?? "crew")}</b> <span class="${e.kind === "error" ? "err" : ""}">${esc(e.message)}</span>${e.cost ? ` <span class="dim">${money(e.cost)}</span>` : ""}${e.ms ? ` <span class="dim">${(e.ms / 1000).toFixed(1)}s</span>` : ""}`;
  $("log").prepend(div);
};
function renderHistory() {
  $("history").innerHTML = S.history.map((h, i) => `<div class="item"><span class="status">${esc(h.role)}</span><div class="grow small">${esc(h.summary)}<div class="dim">${esc(h.source)} · ${new Date(h.at).toLocaleTimeString()} · ${esc(h.changedShots.join(", "))}</div></div>${i === 0 ? `<button class="btn ghost small" id="undo2">Undo</button>` : ""}</div>`).join("") || `<div class="dim">No changes yet.</div>`;
  $("undo2")?.addEventListener("click", undo);
}
async function undo() { const r = await api("/api/undo", {}); toast(r.undone ? `Undid: ${r.undone.summary}` : "Nothing to undo"); exitPreview(); await load(); }
$("undo").addEventListener("click", undo);

const es = new EventSource("/api/events");
es.addEventListener("crew", (m) => logRow(JSON.parse(m.data)));
es.addEventListener("changed", () => { if (!preview) load(); });

// ------------------------------------------------------------------ mode toggles
$("mode").addEventListener("click", async () => { try { const r = await api("/api/mode", { llm: S.mode === "claude" ? "offline" : "claude" }); toast(r.mode === "claude" ? "Claude is crewing (needs ANTHROPIC_API_KEY on the server)" : "Offline crew"); await load(); } catch (e) { toast(e.message, true); } });
$("pipeline").addEventListener("click", async () => { await api("/api/mode", { pipeline: S.pipeline === "full" ? "fast" : "full" }); await load(); });

// ------------------------------------------------------------------ export
let master = null;
const exOpts = () => ({ player, baked: S.baked, title: S.title, preset: $("exSize").value, burnIn: $("exBurn").checked, partSec: Number($("exParts").value) });
$("exTest").addEventListener("click", async () => {
  exitPreview(); setPlaying(false);
  $("exTest").disabled = true; $("exStatus").innerHTML = `<span class="spin"></span> Testing on this machine…`;
  try {
    const m = new MasterRender({ ...exOpts(), onStatus: (s) => ($("exStatus").textContent = s) });
    await m.test(2);
    $("exGo").disabled = false;
  } catch (e) { $("exStatus").textContent = `Test failed: ${e.message}`; }
  $("exTest").disabled = false;
  draw();
});
$("exGo").addEventListener("click", async () => {
  exitPreview(); setPlaying(false);
  $("exGo").disabled = true; $("exStop").hidden = false; $("exProg").hidden = false;
  master = new MasterRender({
    ...exOpts(),
    onStatus: (s) => ($("exStatus").textContent = s),
    onProgress: (frac, eta) => { $("exProg").firstElementChild.style.width = `${(frac * 100).toFixed(1)}%`; if (eta !== null) $("exStatus").textContent = `${Math.round(frac * 100)}% · about ${Math.ceil(eta)}s left`; },
    onPart: ({ index, of, blob, from, to }) => {
      const url = URL.createObjectURL(blob);
      const name = `${S.title.replace(/\W+/g, "_")}_${S.episode.replace(".scene", "")}${of > 1 ? `_part${index}of${of}` : ""}.mp4`;
      $("exParts2").insertAdjacentHTML("beforeend", `<div class="item"><span class="status accepted">part ${index}/${of}</span><div class="grow small">${tc(from)} – ${tc(to)} · ${(blob.size / 1e6).toFixed(1)} MB</div><a class="btn" href="${url}" download="${name}">Download</a></div>`);
      $("exFrom").value = String(index + 1);
    },
  });
  try { await master.run(Number($("exFrom").value) || 1); } catch (e) { $("exStatus").textContent = `Render stopped: ${e.message}`; }
  $("exGo").disabled = false; $("exStop").hidden = true;
  draw();
});
$("exStop").addEventListener("click", () => master?.stop());
const download = (name, text, type = "application/json") => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); };
$("dlBaked").addEventListener("click", () => download("baked.json", JSON.stringify(S.baked)));
$("dlScene").addEventListener("click", () => download(S.episode, S.source, "text/plain"));
$("still").addEventListener("click", () => { draw(); const a = document.createElement("a"); a.href = $("view").toDataURL("image/png"); a.download = `${player.shotAt(t).id}_${tc(t).replace(/:/g, "-")}.png`; a.click(); });

// ------------------------------------------------------------------ misc UI
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x.id === `tab-${b.dataset.tab}`));
}));
$("play").addEventListener("click", () => setPlaying(!playing));
$("prevShot").addEventListener("click", () => jumpShot(-1));
$("nextShot").addEventListener("click", () => jumpShot(1));
$("guidesOn").addEventListener("change", () => ($("guides").hidden = !$("guidesOn").checked));
$("mute").addEventListener("change", () => sound.setMuted($("mute").checked));
const fitGuides = () => { const c = $("view").getBoundingClientRect(), s = $("stage").getBoundingClientRect(); Object.assign($("guides").style, { left: `${c.left - s.left}px`, top: `${c.top - s.top}px`, width: `${c.width}px`, height: `${c.height}px`, right: "auto", bottom: "auto" }); };
new ResizeObserver(fitGuides).observe($("stage"));
document.addEventListener("keydown", (ev) => {
  if (["TEXTAREA", "INPUT", "SELECT"].includes(document.activeElement?.tagName)) return;
  if (ev.key === " ") { ev.preventDefault(); setPlaying(!playing); }
  else if (ev.key === "ArrowRight") seek(t + 1 / baked.fps, false);
  else if (ev.key === "ArrowLeft") seek(t - 1 / baked.fps, false);
  else if (ev.key === "ArrowDown") { ev.preventDefault(); jumpShot(1); }
  else if (ev.key === "ArrowUp") { ev.preventDefault(); jumpShot(-1); }
  else if (ev.key === "Escape") exitPreview();
  else if (ev.key === "n") { ev.preventDefault(); $("noteInput").focus(); }
  else if (ev.key === "z" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); undo(); }
});

load(false).catch((e) => toast(`Couldn't load the show: ${e.message}`, true));
