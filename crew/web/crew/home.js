// Home page pieces: the cut as a living filmstrip with a ticking slate, and the clapperboard header on the composer.
// Built from the open project's own shots (thumbnails, ids, lenses, durations). Styling lives in ui.css under "Home".
const E = window.CrewExt;
const X = () => window.__crew;
const R = () => X().react;
const h = (...a) => R().createElement(...a);

const FPS = 24;
const FRAME_W = 184;
const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const pad = (n, l = 2) => String(Math.max(0, Math.floor(n))).padStart(l, "0");
const timecode = (t) => `${pad(t / 3600)}:${pad((t / 60) % 60)}:${pad(t % 60)}:${pad((t % 1) * FPS)}`;
const useServer = () => { const st = X().store; return R().useSyncExternalStore(st.subscribe, () => st.get().server); };
const episodeNumber = (ep) => { const m = String(ep ?? "").match(/(\d+)/); return m ? pad(Number(m[1])) : "01"; };

/** which shot holds time t, and how far through it (0..1) */
function locate(shots, t) {
  let i = shots.length - 1;
  for (let k = 0; k < shots.length; k++) if (t < shots[k].cutStart + shots[k].cutDur) { i = k; break; }
  const s = shots[i];
  return { i, f: Math.min(1, Math.max(0, (t - s.cutStart) / (s.cutDur || 1))) };
}

export function HomeHero({ title, ep }) {
  const { useRef, useState, useEffect } = R();
  const server = useServer();
  X().useThumbs();
  const shots = server?.baked?.shots ?? [];
  const dur = server?.baked?.duration || shots.reduce((a, s) => Math.max(a, s.cutStart + s.cutDur), 0);
  const open = (server?.notes ?? []).filter((n) => n.status === "open").length;
  const n = shots.length;
  const track = useRef(null), tcEl = useRef(null), fill = useRef(null);
  const [cur, setCur] = useState(0);

  useEffect(() => {
    if (!n || !dur) return;
    const still = reduced();
    let raf = 0, last = performance.now(), t = 0, idx = -1;
    const draw = () => {
      const { i, f } = locate(shots, t);
      if (track.current) track.current.style.transform = `translate3d(${-(n + i + f) * FRAME_W}px,0,0)`;
      if (tcEl.current) tcEl.current.textContent = timecode(t);
      if (fill.current) fill.current.style.transform = `scaleX(${(t / dur).toFixed(4)})`;
      if (i !== idx) { idx = i; setCur(i); }
    };
    const tick = (now) => {
      t = (t + Math.min(0.1, (now - last) / 1000)) % dur;
      last = now;
      draw();
      raf = requestAnimationFrame(tick);
    };
    draw();
    if (!still) raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [n, dur]);

  const shot = shots[Math.min(cur, Math.max(0, n - 1))];
  const frames = [];
  for (let c = 0; c < 3; c++) shots.forEach((s, i) => {
    const url = X().thumb(s);
    frames.push(h("div", { key: `${c}-${s.id}`, className: "hh-frame" + (c === 1 && i === cur ? " on" : ""), style: { width: FRAME_W } },
      h("div", { className: "hh-pic" }, url && h("img", { src: url, alt: "", draggable: false })),
      h("div", { className: "hh-cap" }, h("b", null, s.id), h("span", null, `${s.lens}mm`))));
  });

  return h("section", { className: "hh", "data-testid": "home-hero" },
    h("div", { className: "hh-top" },
      h("div", { className: "hh-head" },
        h("div", { className: "hh-kicker" }, h("i", { className: "hh-tally" }), `Episode ${Number(episodeNumber(ep))}`),
        h("h1", { className: "hh-title" }, title || "Untitled"),
        h("div", { className: "hh-actions" },
          h("button", { className: "hh-go", "aria-label": `Continue ${title}`, onClick: () => X().go("review") }, "Continue", h("span", { "aria-hidden": true }, "→")),
          h("span", { className: "hh-meta" }, `${n} shot${n === 1 ? "" : "s"}`, dur ? ` · ${Math.floor(dur / 60)}:${pad(dur % 60)}` : "", open ? ` · ${open} open note${open === 1 ? "" : "s"}` : ""))),
      h("div", { className: "hh-slate", "aria-hidden": true },
        h("div", { className: "hh-tc tc", ref: tcEl }, "00:00:00:00"),
        h("div", { className: "hh-cells" },
          h("div", null, h("small", null, "Shot"), h("b", null, shot?.id ?? "-")),
          h("div", null, h("small", null, "Lens"), h("b", null, shot ? `${shot.lens}mm` : "-")),
          h("div", null, h("small", null, "Type"), h("b", null, shot?.type ?? shot?.label?.split(" ")[0] ?? "-"))),
        h("div", { className: "hh-bar" }, h("i", { ref: fill })))),
    h("div", { className: "hh-strip", "aria-hidden": true },
      h("div", { className: "hh-track", ref: track, style: { transform: `translate3d(${-n * FRAME_W}px,0,0)` } }, frames),
      h("div", { className: "hh-head-line" })));
}

/** Clapperboard header for the composer: the sticks, then Scene / Shot / Take. */
export function SlateHead({ mode }) {
  const server = useServer();
  const shots = server?.baked?.shots ?? [], notes = server?.notes ?? [];
  const note = mode === "note";
  return h("div", { className: "sl", "aria-hidden": true },
    h("div", { className: "sl-stick" }),
    h("div", { className: "sl-row" },
      h("div", null, h("small", null, "Scene"), h("b", null, episodeNumber(server?.episode))),
      h("div", null, h("small", null, "Shot"), h("b", null, note ? (shots[0]?.id ?? "-") : "new")),
      h("div", null, h("small", null, "Take"), h("b", null, note ? pad(notes.length + 1) : "01")),
      h("div", { className: "sl-for" }, h("small", null, note ? "Direction" : "Script"), h("b", null, note ? "Note on the cut" : "Break into shots"))));
}

E.ui = Object.assign(E.ui ?? {}, { HomeHero, SlateHead });
