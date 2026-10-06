// Features that make the program more than the sum of its buttons: a one-click client package, a project backup,
// "ask the crew to fix this" on QC issues, and commands for the palette (Cmd/Ctrl+K).
import { baked, server, download, toast, sink, zipStore, projectName, episodeName } from "./exports/util.js";

const E = window.CrewExt;
const X = () => window.__crew;
const base = () => `${projectName()}_${episodeName()}`;
const folder = (n) => (/\.(edl|xml|otio)$/i.test(n) ? "editorial/" : /\.(chan|py|jsx|glb)$/i.test(n) ? "camera/" : "review/");

// ---- client package -----------------------------------------------------------------------------------------

const PACKAGE = [
  ["Shot list export", { group: true }],
  ["EDL export", { handles: 12, takeLetters: true }],
  ["Final Cut XML export", { handles: 12, takeLetters: true }],
  ["OpenTimelineIO export", { handles: 12, takeLetters: true }],
  ["SRT export", {}],
  ["Chapter list export", {}],
  [".chan camera export", { shots: "all", framing: true }],
  ["Blender camera script", { shots: "all", framing: true }],
  ["After Effects camera script", { shots: "all", framing: true }],
  ["glTF camera export", { shots: "all", framing: true }],
  ["Storyboard image export", { frames: "3" }],
  ["The phone shoot pack", { frameLines: "none", outlines: true }],
];

E.on("Delivery package", async () => {
  const sv = server(), b = baked(), qc = sv.qc, notes = [];
  const files = [];
  sink.files = files;
  try {
    for (let i = 0; i < PACKAGE.length; i++) {
      const [name, ctx] = PACKAGE[i];
      toast(`Client package ${i + 1} of ${PACKAGE.length}: ${name.replace(/ export$/, "").toLowerCase()}...`);
      try { await E.handlers[name](ctx); } catch (e) { notes.push(`${name}: ${e.message}`); }
    }
  } finally { sink.files = null; }
  const done = (await Promise.all(files)).map((f) => ({ name: folder(f.name) + f.name, data: f.data }));
  const issues = qc?.issues ?? [];
  const readme = [
    `${sv.title} · ${sv.episode}`,
    `Client package, ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `${b.shots.length} shots, ${Math.round(b.duration)} s at ${b.fps} fps.`,
    ``,
    `editorial/   EDL, Final Cut XML and OpenTimelineIO. Clip names are the shot ids (1A.mp4); 12 frames of handles.`,
    `camera/      the camera, keyed every frame: .chan (Maya, Nuke), Blender script, After Effects script, glTF.`,
    `review/      shot list (csv, grouped by camera setup), captions (.srt), YouTube chapters, storyboard frames, phone shoot pack.`,
    ``,
    `QC: ${issues.filter((i) => i.severity === "error").length} errors, ${issues.filter((i) => i.severity === "warn").length} warnings.`,
    ...issues.slice(0, 30).map((i) => `  - ${i.severity} ${i.shot ?? ""} ${i.message}`),
    ...(notes.length ? ["", "Not included:", ...notes.map((n) => "  - " + n)] : []),
    "",
  ].join("\n");
  done.push({ name: "README.txt", data: new TextEncoder().encode(readme) });
  download(`${base()}_client_package.zip`, new Blob([zipStore(done)], { type: "application/zip" }));
  toast(`Client package: ${done.length - 1} files in one zip${notes.length ? ` (${notes.length} skipped)` : ""}.`, notes.length ? "info" : "ok");
});

// ---- project backup -------------------------------------------------------------------------------------------------

E.on("Project backup", async () => {
  const sv = server(), enc = new TextEncoder(), files = [];
  const put = (name, text) => files.push({ name, data: enc.encode(text) });
  put("show.scene", sv.showSource ?? "");
  put(sv.episode ?? "ep01.scene", sv.source ?? "");
  put("notes.json", JSON.stringify(sv.notes ?? [], null, 2));
  put("history.json", JSON.stringify(sv.history ?? [], null, 2));
  put("baked.json", JSON.stringify(sv.baked));
  const urls = [...new Set(baked().audio.filter((a) => a.src).map((a) => a.src))];
  for (const u of urls) { try { const r = await fetch(u); if (r.ok) files.push({ name: "voices/" + u.split("/").pop(), data: new Uint8Array(await r.arrayBuffer()) }); } catch {} }
  download(`${base()}_backup.zip`, new Blob([zipStore(files)], { type: "application/zip" }));
  toast(`Backup: the show, the episode, ${sv.notes?.length ?? 0} notes, history and ${urls.length} dialogue clips.`);
});

// ---- QC: hand an issue to the crew -----------------------------------------------------------------------------------

const noteFor = (i) => `Fix this problem in ${i.shot ?? i.addr}${i.local !== undefined ? ` at ${i.local.toFixed(1)}s` : ""}: ${i.message}`;
E.on("Asking the crew to fix an issue", async ({ issue }) => {
  await X().api.note(noteFor(issue));
  X().go("review");
  toast("Sent to the crew as a note. Their takes will be under Notes.");
});

// ---- the command palette ---------------------------------------------------------------------------------------------------

const st = () => X().store;
const lookOn = () => st().get().look ?? E.lookDefault;
E.commands = () => {
  const L = E.look?.settings, go = (h, c = {}) => () => E.handlers[h]?.(c);
  const cmds = [
    { id: "x-package", group: "Deliver", label: "Make the client package (zip)", words: "everything delivery edl xml otio shot list camera", run: go("Delivery package") },
    { id: "x-backup", group: "Deliver", label: "Download a project backup (zip)", words: "save export show scene notes", run: go("Project backup") },
    { id: "x-voices", group: "Deliver", label: "Render dialogue voices", words: "tts clips audio", run: go("Rendering voices") },
    { id: "x-edl", group: "Deliver", label: "Export EDL, Final Cut XML and OTIO with handles", run: async () => { for (const h of ["EDL export", "Final Cut XML export", "OpenTimelineIO export"]) await E.handlers[h]({ handles: 12, takeLetters: true }); } },
    { id: "x-srt", group: "Deliver", label: "Export captions (.srt)", run: go("SRT export") },
    { id: "x-frame", group: "Deliver", label: "Save the current frame (PNG)", run: go("Frame export") },
    { id: "x-fs", group: "View", label: "Fullscreen viewer", hint: "F", words: "present", run: () => document.querySelector(".viewer-frame")?.requestFullscreen?.() },
    { id: "x-names", group: "View", label: "Toggle character name cards", run: go("Lower-third title cards") },
    { id: "x-fixqc", group: "Crew", label: "Ask the crew to fix every QC error", words: "quality checks problems", run: async () => {
      const errs = (server().qc?.issues ?? []).filter((i) => i.severity === "error");
      if (!errs.length) return toast("No QC errors to fix.", "ok");
      await X().api.note(`Fix these problems: ${errs.map((i) => `${i.shot ?? i.addr}: ${i.message}`).join("; ")}`);
      X().go("review"); toast(`Sent ${errs.length} problem${errs.length > 1 ? "s" : ""} to the crew.`);
    } },
  ];
  if (E.look) cmds.push(
    { id: "x-look", group: "Look", label: lookOn() ? "Film look: turn off" : "Film look: turn on", words: "bloom grade grain depth of field", run: () => st().set({ look: !lookOn() }) },
    ...["Draft", "High", "Ultra"].map((n, i) => ({ id: "x-q" + i, group: "Look", label: `Viewer quality: ${n}`, run: () => st().set({ look: true, lookQ: i }) })),
    { id: "x-dof", group: "Look", label: "Depth of field: toggle", words: "lens blur bokeh", run: () => X().setLook({ dof: !X().look().dof }) },
    ...[1, 8, 32].map((n) => ({ id: "x-spp" + n, group: "Look", label: `Render passes per frame: ${n}`, words: "quality motion blur antialiasing", run: () => { E.render.setSpp(n); toast(`Renders use ${n} pass${n > 1 ? "es" : ""} per frame.`); } })),
    ...["ao", "rays", "clouds"].map((k) => ({ id: "x-a" + k, group: "Look", label: `Atmosphere: ${{ ao: "occlusion", rays: "god rays", clouds: "clouds" }[k]} toggle`, run: () => { L.atmos = { ...(L.atmos ?? {}), [k]: !(L.atmos?.[k] ?? true) }; E.lookChanged?.(); } })),
  );
  return cmds;
};

// F toggles fullscreen on the viewer (when not typing)
document.addEventListener("keydown", (e) => {
  if (e.key !== "f" || e.metaKey || e.ctrlKey || e.altKey || /input|textarea|select/i.test(e.target?.tagName ?? "") || e.target?.isContentEditable) return;
  const el = document.querySelector(".viewer-frame");
  if (!el) return;
  document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.();
});

E.wired();
