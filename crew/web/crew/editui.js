// The timeline's editing UI: extra lanes (overlays V2/V3, your audio A3/A4), clip drag, trim and split, the Edit bar,
// drop-to-import, and the clip inspector. The bundle's timeline (CE) renders these through small CREW-EXT hooks.
// Components are plain React elements (the bundle's own React, handed over in window.__crew.react); styling is in ui.css (.xe-*).
const E = window.CrewExt;
const X = () => window.__crew;
const R = () => X().react;
const h = (...a) => R().createElement(...a);

export const LANE_H = { V3: 38, V2: 38, A3: 30, A4: 30 };

function useEdit() {
  const st = X().store;
  return R().useSyncExternalStore(st.subscribe, () => st.get().editRev ?? 0);
}
const usePage = () => { const st = X().store; return R().useSyncExternalStore(st.subscribe, () => st.get().page); };
const api = () => E.editApi;
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** Which tracks to show: Edit shows V2 and A3 always (so there is somewhere to drop), the others once they hold something. */
export function visibleTracks(editing) {
  const used = new Set(api().clips().map((c) => c.track));
  return {
    V3: used.has("V3") || (editing && used.has("V2")),
    V2: editing || used.has("V2"),
    A3: editing || used.has("A3"),
    A4: used.has("A4") || (editing && used.has("A3")),
  };
}

const TAGS = { V3: "V3", V2: "V2", A3: "A3", A4: "A4" };
const NAMES = { V3: "Overlay 2", V2: "Overlay", A3: "Your audio", A4: "Your audio 2" };

/** Label rows for the left column. `place` is "above" (V tracks) or "below" (A tracks). */
export function EditLabels({ place }) {
  useEdit();
  const editing = usePage() === "edit", vis = visibleTracks(editing);
  const ids = place === "above" ? ["V3", "V2"] : ["A3", "A4"];
  return h(R().Fragment, null, ids.filter((t) => vis[t]).map((t) =>
    h("div", { key: t, className: "xe-label", style: { height: LANE_H[t] } },
      h("span", { className: "tc xe-tag " + (t[0] === "V" ? "xe-tag-v" : "xe-tag-a") }, TAGS[t]),
      h("span", { className: "xe-name" }, NAMES[t]))));
}

/** One lane of clips. `pps` is pixels per second, `ra` the left gutter of the timeline. */
function Lane({ track, pps, ra, editing }) {
  useEdit();
  const clips = api().clipsOn(track), sel = api().selected()?.id;
  const drag = R().useRef(null);

  const down = (e, c, mode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    api().select(c.id);
    if (!editing) return;
    api().begin();
    drag.current = { id: c.id, mode, x: e.clientX, t: c.t, end: c.t + c.dur, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const dt = (e.clientX - d.x) / pps;
    if (Math.abs(e.clientX - d.x) > 2) d.moved = true;
    const snapOpts = { ignore: d.id, pps };
    if (d.mode === "move") {
      let t = Math.max(0, d.t + dt);
      const len = d.end - d.t;
      const a = api().snap(t, snapOpts), b = api().snap(t + len, snapOpts) - len;
      t = Math.abs(a - t) <= Math.abs(b - t) ? a : b;
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-track]")?.getAttribute("data-track");
      api().move(d.id, { t: Math.max(0, t), track: under || undefined });
    } else if (d.mode === "l") api().trim(d.id, "l", api().snap(d.t + dt, snapOpts));
    else api().trim(d.id, "r", api().snap(d.end + dt, snapOpts));
  };
  const up = () => { drag.current = null; };

  return h("div", { className: "xe-lane", "data-track": track, style: { height: LANE_H[track] } },
    clips.map((c) => {
      const it = api().itemOf(c), isA = track[0] === "A", on = sel === c.id;
      const wave = isA && it ? api().wave(it) : null;
      const style = { left: ra + c.t * pps, width: Math.max(4, c.dur * pps - 1) };
      if (!isA && it?.thumb) style.backgroundImage = `url(${it.thumb})`;
      return h("div", {
        key: c.id, "data-clip": c.id, title: `${it?.name ?? "clip"} · ${fmt(c.t)} to ${fmt(c.t + c.dur)}${c.key?.on ? " · keyed" : ""}`,
        className: `xe-clip ${isA ? "xe-clip-a" : "xe-clip-v"}${on ? " on" : ""}${c.mute ? " mute" : ""}`, style,
        onPointerDown: (e) => down(e, c, "move"), onPointerMove: move, onPointerUp: up, onPointerCancel: up,
      },
        wave && h("img", { src: wave, alt: "", draggable: false, className: "xe-wave" }),
        h("span", { className: "xe-clip-name" }, it?.name ?? "missing media"),
        c.key?.on && h("span", { className: "xe-badge" }, "KEY"),
        editing && h("span", { className: "xe-grip xe-grip-l", onPointerDown: (e) => down(e, c, "l"), onPointerMove: move, onPointerUp: up }),
        editing && h("span", { className: "xe-grip xe-grip-r", onPointerDown: (e) => down(e, c, "r"), onPointerMove: move, onPointerUp: up }));
    }));
}

export function EditLanes({ place, pps, ra }) {
  useEdit();
  const editing = usePage() === "edit", vis = visibleTracks(editing);
  const ids = place === "above" ? ["V3", "V2"] : ["A3", "A4"];
  return h(R().Fragment, null, ids.filter((t) => vis[t]).map((t) => h(Lane, { key: t, track: t, pps, ra, editing })));
}

/** Files dropped on the timeline: pictures and footage to the overlay lanes, sound to Your audio. */
export function dropFiles(ev, time) {
  const files = [...(ev.dataTransfer?.files ?? [])];
  if (!files.length) return;
  const track = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.("[data-track]")?.getAttribute("data-track");
  api().importFiles(files, { t: time, track: track || undefined }).then((cl) => cl.length && X().toast(`Added ${cl.length} clip${cl.length === 1 ? "" : "s"} to the timeline.`));
}

/** The Edit bar in the timeline header: split, delete, voices, record. Only on the Edit page. Importing lives in the media pool. */
export function EditBar() {
  useEdit();
  const editing = usePage() === "edit";
  const [rec, setRec] = R().useState(false);
  if (!editing) return null;
  const sel = api().selected();
  const btn = (label, on, opts = {}) => h("button", { className: "xe-btn" + (opts.accent ? " accent" : ""), onClick: on, disabled: opts.disabled, title: opts.title }, label);
  return h("div", { className: "xe-bar", onPointerDown: (e) => e.stopPropagation() },
    btn("Split", () => { if (!api().splitAtPlayhead()) X().toast("Park the playhead inside one of your clips, then split.", "info"); }, { title: "Split at the playhead (S)" }),
    btn("Delete", () => sel && api().remove(sel.id), { disabled: !sel, title: "Delete the selected clip (Delete)" }),
    btn("Voices", () => window.CrewExt.handlers["Rendering voices"]?.({}), { title: "Render the cast's dialogue with the voice bank and retime the cut to it" }),
    btn(rec ? "Stop" : "Record", () => { setRec(!rec); window.CrewExt.handlers["Recording a voiceover"]?.({}); }, { title: "Record a voiceover from the playhead onto Your audio" }));
}

// S and Delete on the Edit page, when nothing is being typed
window.addEventListener("keydown", (e) => {
  if (X()?.store?.get().page !== "edit" || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
  const sel = api().selected();
  if (e.key === "s" || e.key === "S") { if (api().clips().length) { e.preventDefault(); api().splitAtPlayhead(); } }
  else if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); api().remove(sel.id); }
});

// ---- the clip inspector, shown at the top of the Edit page's inspector while one of your clips is selected --------------------

const row = (label, control) => h("label", { className: "xe-row" }, h("span", null, label), control);
const range = (v, min, max, step, on, fmtv = (x) => x) => h("span", { className: "xe-range" }, h("input", { type: "range", min, max, step, value: v, onChange: (e) => on(Number(e.target.value)) }), h("output", null, fmtv(v)));
const pct = (x) => `${Math.round(x * 100)}%`;

export function ClipInspector() {
  useEdit();
  const c = api().selected();
  if (!c) return null;
  const it = api().itemOf(c), A = api(), isV = c.track[0] === "V", set = (p) => A.update(c.id, p), key = (p) => A.update(c.id, { key: p });
  const sound = [
    row("Sound", h("span", { className: "xe-inline" }, h("input", { type: "checkbox", checked: !c.mute, onChange: (e) => set({ mute: !e.target.checked }) }), range(c.gain, 0, 2, 0.05, (v) => set({ gain: v }), pct))),
    row("Fade in", range(c.fadeIn, 0, Math.min(5, c.dur), 0.1, (v) => set({ fadeIn: v }), (x) => x.toFixed(1) + " s")),
    row("Fade out", range(c.fadeOut, 0, Math.min(5, c.dur), 0.1, (v) => set({ fadeOut: v }), (x) => x.toFixed(1) + " s")),
  ];
  const green = [
    h("div", { key: "g", className: "xe-sub" }, "Green screen"),
    row("Key out a colour", h("input", { type: "checkbox", checked: !!c.key?.on, onChange: (e) => { if (!e.target.checked) return key({ on: false }); const col = A.autoKey(c.id); X().toast(col ? `Green screen found (${col}). Adjust Reach if edges are left over.` : "No green or blue screen found in the first frame. Pick the colour by hand.", col ? "info" : "error"); } })),
    c.key?.on && h(R().Fragment, { key: "k" },
      row("Screen colour", h("span", { className: "xe-inline" }, h("input", { type: "color", value: c.key.color, onChange: (e) => key({ color: e.target.value }) }), h("button", { className: "xe-btn", onClick: () => { const col = A.autoKey(c.id); X().toast(col ? `Found the screen: ${col}.` : "No green or blue screen found in the first frame. Pick the colour by hand.", col ? "info" : "error"); } }, "Find it"))),
      row("Reach", range(c.key.tol, 0.05, 0.8, 0.01, (v) => key({ tol: v }), pct)),
      row("Soft edge", range(c.key.soft, 0, 0.5, 0.01, (v) => key({ soft: v }), pct)),
      row("Remove spill", range(c.key.spill, 0, 1, 0.05, (v) => key({ spill: v }), pct))),
  ];
  const picture = [
    h("div", { key: "p", className: "xe-sub" }, "Picture"),
    row("Size", range(c.scale, 0.1, 3, 0.05, (v) => set({ scale: v }), pct)),
    row("Across", range(c.x, 0, 1, 0.01, (v) => set({ x: v }), pct)),
    row("Down", range(c.y, 0, 1, 0.01, (v) => set({ y: v }), pct)),
    row("Opacity", range(c.opacity, 0, 1, 0.05, (v) => set({ opacity: v }), pct)),
  ];
  return h("section", { className: "xe-insp", "aria-label": "Clip" },
    h("div", { className: "xe-insp-head" }, h("b", null, it?.name ?? "Clip"), h("span", null, `${c.track} · ${fmt(c.dur)}`)),
    h("div", { className: "xe-actions" },
      h("button", { className: "xe-btn", onClick: () => A.split(c.id, X().clock.t) }, "Split at playhead"),
      h("button", { className: "xe-btn", onClick: () => A.duplicate(c.id) }, "Duplicate"),
      h("button", { className: "xe-btn danger", onClick: () => A.remove(c.id) }, "Delete")),
    ...(isV ? [...green, ...picture] : []),
    h("div", { className: "xe-sub" }, "Sound"),
    ...(isV && !it?.buffer ? [] : sound));
}

// ---- the media pool and the Source monitor (Edit page) ---------------------------------------------------------------------------

const clock = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;

export function MediaBin() {
  useEdit();
  const items = api().items(), sel = api().binSel()?.id, input = R().useRef(null);
  const addFiles = (files) => files.length && api().importFiles(files).then((cl) => cl.length && X().toast(`Added ${cl.length} clip${cl.length === 1 ? "" : "s"} at the playhead.`));
  return h("section", { className: "panel flex min-h-0 flex-1 flex-col", "aria-label": "Media" },
    h("div", { className: "panel-head" }, h("span", null, "Media"), h("span", { className: "text-tx-faint" }, items.length ? `${items.length} file${items.length === 1 ? "" : "s"}` : ""),
      h("button", { className: "xe-btn accent", style: { marginLeft: "auto" }, onClick: () => input.current?.click() }, "Import")),
    h("input", { ref: input, type: "file", multiple: true, accept: "audio/*,video/*,image/*", hidden: true, onChange: (e) => { const f = [...e.target.files]; e.target.value = ""; addFiles(f); } }),
    h("div", { className: "xe-pool", onDragOver: (e) => e.preventDefault(), onDrop: (e) => { e.preventDefault(); addFiles([...(e.dataTransfer?.files ?? [])]); } },
      items.length === 0
        ? h("div", { className: "xe-empty" }, h("b", null, "Add your own sounds, pictures and footage"), h("p", null, "Drop files here or on the timeline. Footage shot on a green screen can be keyed out and placed over the film."))
        : items.map((it) => h("div", { key: it.id, className: "xe-item" + (sel === it.id ? " on" : ""), onClick: () => api().binSelect(it.id), onDoubleClick: () => api().addClip(it.id, { t: X().clock.t }), title: "Click to preview, double-click to add at the playhead" },
          h("div", { className: "xe-thumb", style: it.thumb ? { backgroundImage: `url(${it.thumb})` } : null }, !it.thumb && h("img", { src: api().wave(it) ?? "", alt: "", draggable: false })),
          h("div", { className: "xe-item-name" }, it.name),
          h("div", { className: "xe-item-meta" }, `${it.kind}${it.kind === "image" ? "" : " · " + clock(it.dur)}`)))));
}

export function SourceMonitor() {
  useEdit();
  const it = api().binSel();
  return h("section", { className: "panel flex min-h-0 min-w-0 flex-1 flex-col", "aria-label": "Source" },
    h("div", { className: "panel-head" }, h("span", null, "Source"), h("span", { className: "text-tx-faint xe-trunc" }, it?.name ?? "")),
    h("div", { className: "xe-source" },
      !it ? h("p", { className: "xe-empty-line" }, "Pick a file in Media to preview it here.")
        : it.kind === "image" ? h("img", { key: it.id, src: it.url, alt: it.name })
        : it.kind === "video" ? h("video", { key: it.id, src: it.url, controls: true, playsInline: true })
        : h("div", { key: it.id, className: "xe-audio" }, h("img", { src: api().wave(it) ?? "", alt: "" }), h("audio", { src: it.url, controls: true }))),
    it && h("div", { className: "xe-source-bar" },
      h("button", { className: "xe-btn accent", onClick: () => api().addClip(it.id, { t: X().clock.t }) }, "Add at playhead"),
      h("button", { className: "xe-btn danger", onClick: () => api().removeItem(it.id) }, "Remove from project")));
}

E.ui = { MediaBin, SourceMonitor, EditLabels, EditLanes, EditBar, ClipInspector, dropFiles, LANE_H, visibleTracks };
