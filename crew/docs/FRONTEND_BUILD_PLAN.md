# Frontend build plan (v9)

Plan for building out the v9 frontend so every button does something real. Written for an executor model (Sonnet) to follow step by step. Read this whole file first, then `CLAUDE.md`, `docs/HANDOFF.md` and `docs/FRONTEND_PROMPT.md`.

## Ground rules (the user's, non-negotiable)

- The asset library stays backend-only. No page, panel or API that lets a user browse `library/`. The frontend may load files from `/library/...` by known path (prop registry, character GLBs), nothing more. "Browse scenes…" in the Create page must NOT become an asset browser: wire it to the show's own scenes (see 6.9) or leave the toast.
- The Bob's voice clips stay deleted. Never restore or reference them.
- No em dashes in any text you write (UI strings, docs, commit messages).
- Branch: `claude/crew-props-sets-library-vfdnbk`. Commit and push there. Do not open a PR.
- Run `npm test` and `npm run typecheck` before every commit. Both must pass (24 tests at time of writing).
- Commit trailer: the one given in the session's attribution reminder.

## Where things stand

Already done (committed with this plan):

- The v9 build the user supplied (`crew-v9.html`, a single-file Vite/React/Tailwind bundle with three r186 inlined) is unpacked into `web/`:
  - `web/index.html`: the shell. Loads `app.css`, `crew-ui.css`, then the module `web/crew/boot.js`.
  - `web/app.js`: the bundle's JS, prettier-formatted (61k lines). There is no original source; this file IS the source now. Names are minified (`ke`, `da`, `sn`...), so edit carefully and keep edits small.
  - `web/app.css` (Tailwind output), `web/crew-ui.css` (v9 overrides).
  - `web/crew/boot.js`: currently just `await import("/app.js")`.
- The old vanilla viewer moved to `web/classic/` (open `/classic/` to compare). Keep it working; don't extend it.

Not yet done: nothing in v9 has been smoke-tested against the real server. That is step 1.

## Architecture: hooks in the bundle, features in readable modules

Do not write features inside `web/app.js`. Instead:

1. `web/app.js` gets a few small, marked patches (comment each with `// CREW-EXT:`) that call into `window.CrewExt` and expose internals on `window.__crew`.
2. All feature code lives in readable ES modules under `web/crew/` (one file per area), registered on `window.CrewExt` by `boot.js` before it imports `/app.js`.
3. Every hook must degrade: if `CrewExt` or a handler is missing, or the app is in offline demo mode (`$u()` true, no server), behaviour falls back to what v9 does today.

`grep -n "CREW-EXT" web/app.js` must list every patch. Keep that list in this file's appendix up to date.

### Bundle map (line numbers in `web/app.js` as of this commit)

| Symbol | Line | What it is |
|---|---|---|
| `ju(n)` | 12823 | in-browser SCENE parser (demo mode only) |
| `qh(n)` | 13361 | in-browser bake (demo mode only) |
| `IC(n,e)` | 13825 | demo OTIO builder |
| `class FC` / `Av` | 13875 / 14655 | offline demo backend (handles `/api/*` when no server) |
| `od`, `$u()` | 14656-14657 | `true` = demo mode, no server |
| `BC()` | 14658 | first `/api/state` fetch; sets `od` |
| `Cs(method,url,body,query)` | 14673 | fetch wrapper (routes to `Av` in demo mode) |
| `Ji` | 14701 | API client object (state, note, preview, accept, reject, rate, patch, putEpisode, undo, screen, otio, mode) |
| `HC` | 14722 | SSE subscription |
| `qi` | 14747 | per-shot manual framing overrides (localStorage `crew.framing.v2.<id>`) |
| `Me` | 15088 | playback clock (`Me.t`, `Me.pause()`, `Me.configure(dur,fps)`) |
| `sP(box)` | 44888 | normalises a baked box to `{x,y,z,w,h,d,color}` (drops everything else) |
| `class da` | 44910 | the 3D viewer: `load(baked)`, `ready()`, `frame(t)`, `setFixedSize([w,h])`, `dispose()`, `buildSet(set)` at 45064, `tryGlb` |
| `pp(baked,..)` | 45275 | preview loader |
| `ke` | 45353 | the app store: `ke.get()`, `ke.set(partial)`, `ke.subscribe(fn)`; React reads via `Ne(selector)` |
| `_n(text, kind, action)` | 45369 | toast |
| `Mi(page)` | 45627 | page navigation ("review", "deliver", "edit"...) |
| `wd(t, baked, ...)` | 48062 | shot lookup by time |
| `sn(what)` | 49108 | THE STUB: toasts "<what> isn't wired up yet." |
| `Fp()` | 49109 | "not wired" badge |
| `ds({title,note})` | 49381 | Deliver section; always renders `Fp` badge |
| `ti({label, what})` | 49401 | export button; calls `sn(what)` |
| `q5` | 49408 | Deliver page: camera exports, storyboard, shot list, shoot pack |
| `Y5` | 49544 | Hand off to editorial (OTIO, EDL, FCP XML, clips) |
| `K5` | 49595 | Crew style (taste learning) |
| `J5` | 49679 | Create page (templates, sizes, captions, voiceover, logo, fit to length, thumbnails) |
| `class M4` / `Uf` | 53838 / 53913 | live audio; dialogue uses `speechSynthesis` only |
| VideoEncoder render | ~53920-54140 | MP4 render (WebCodecs) |
| `C4(baked,t,w,h,assets)` | 54148 | renders one still to a PNG Blob. Reuse it for storyboards and frame export |
| `TC.createRoot` | 61672 | app mount |

Line numbers drift as you patch. Re-grep by symbol (`grep -n "^class da" web/app.js`) rather than trusting the numbers.

### Every stub, by line

`sn(` calls: 49249 Focus pulls, 49294 Auto-reframing every shot, 49341 Syncing footage over the previs, 49471 Storyboard printing, 49500 Shot list printing, 49505 Overhead plan printing, 49588 Checking a cut against the editor's timeline, 49653 Learning from a reference scene, 49660 Resetting the crew's style, 49715 Starting from a template, 49720 The scene library, 49761 Rendering every size, 49818 Syncing a voiceover and lip-sync, 49824 Recording a voiceover, 49883 Placing your logo on renders, 49895 Lower-third title cards, 49938 Fitting the cut to a target length, 49960 The thumbnail maker, 50286 Dragging beats to retime, 56427 Creating a review link, 59636/60668/60753 Switching projects, 59769 Breaking a script into shots, 60671 Renaming projects, 60672 Duplicating projects, 60674 Archiving projects.

`ti` buttons (`what` strings): glTF camera export, .chan camera export, Blender camera script, After Effects camera script, FBX camera export, Storyboard image export, Shot list export, The phone shoot pack, OpenTimelineIO export, EDL export, Final Cut XML export, Per-shot clip export (twice), Transparent ProRes export, WebM alpha export, PNG sequence export, SRT export, Chapter list export, Frame export.

## Steps

Do them in order. Each step ends with its own commit.

### Step 1. Smoke test v9 against the real server

1. `npm start` (port 4310). Open `http://localhost:4310/` in Playwright Chromium (preinstalled; `/opt/node-tools/node_modules/playwright`, launch with `executablePath: '/opt/pw-browsers/chromium'` if needed, args `--use-angle=swiftshader --enable-unsafe-swiftshader` for WebGL).
2. Write the harness at `test/e2e/smoke.mjs` (not under `web/`). It must: load the page, wait for the viewer canvas, collect console errors and failed requests, take screenshots of each page (review, edit, deliver, create) into the scratchpad, and assert the app is in server mode (no demo banner; `/api/state` was fetched with 200).
3. Fix anything that breaks because the server bake differs from the demo bake (compare `Av.state()` output with `GET /api/state` field by field: `baked.sets`, `baked.shots[]`, `baked.audio`, `baked.cast`, `assets`, `shots`, `qc`, `history`, `notes`). Fix mismatches in the frontend (an adapter in `web/crew/adapt.js` called from a hook in `BC()`/`Ji.state`), not by changing the server API, unless the server is clearly missing data the brief promised.
4. Also verify the demo still works: serve `web/` with any static server where `/api/state` 404s, or open the file directly; it must fall back to `Av`.

Done when: all four pages render in server mode with zero console errors, and demo mode still works.

### Step 2. Hook layer

1. `web/crew/boot.js`: create `window.CrewExt = { handlers: {}, on(what, fn), run(what, ctx) }`, import every feature module (each calls `CrewExt.on(...)`), preload the prop registry (step 3), then `await import("/app.js")`. A failed preload must not stop the app from loading.
2. Patch `sn` (49108): `const sn = (n, ctx) => window.CrewExt?.handlers?.[n] ? Promise.resolve(window.CrewExt.run(n, ctx)).catch((e) => _n(e.message ?? String(e), "err")) : _n(\`${n} isn't wired up yet.\`, "info");`. Check the toast kinds `_n` accepts ("info", "err"? grep its callers) and use the right one.
3. Patch `ti` (49401) to pass a context: `({ label: n, what: e, ctx: c }) => ... onClick: () => sn(e, c)`. Then at each `ti` call site and each `sn(` call site, pass the local option state as `ctx` (for example in `q5`: `{ shots: e, framing: i, frames: o, group: h, outlines: f, frameLines: x }`; in `Y5`: `{ handles: Number(t), takeLetters: n }`). Read each component's `useState` list to name them.
4. Patch `Fp`/`ds` so a section only shows "not wired" if any of its buttons has no handler. Simplest: give `ds` an optional `wired` prop and pass `wired: true` from sections you finish; `Fp` renders only when `!wired`.
5. Expose internals once, right after the store is defined and again after `da`/`C4`/`Uf` exist: `window.__crew = Object.assign(window.__crew ?? {}, { store: ke, api: Ji, toast: _n, go: Mi, demo: () => $u(), Viewer: da, still: C4, clock: Me, audio: Uf, framing: () => qi })`. Feature modules read `window.__crew` at call time, never at import time.

Done when: an unhandled stub still toasts as before, and a dummy handler registered from the console runs with the right `ctx`.

### Step 3. Sets and props from the library (the biggest visible win)

Context: `baked.sets[id]` from the server is `{ w, d, h, open, boxes, anchors, props }`. Each box has `x, y, z, w, h, d` plus `prop` (registry id or null), `ry`, `decor`, `dress`, `scale`, `color`. The registry at `/library/props/index.js` exports `PROPS`, `buildProp(id, THREE)`, `buildBox(box, THREE)` (returns a `THREE.Group` sized and centred to the box, or null). See `docs/FRONTEND_PROMPT.md` "Sets, props and set dressing" and `web/classic/player.js` for a working reference of all of this.

1. `web/crew/props.js`: preload `import("/vendor/three/three.module.js")` and `import("/library/props/index.js")`. Both are three r186, same as the bundle, so meshes built with the vendor copy render fine in the bundle's renderer (verify; if three warns about multiple instances, that is acceptable). Export `CrewExt.buildBox(box)` returning an Object3D or null. Cache nothing across loads that holds GPU memory without disposal.
2. Patch `sP` to keep the full box (spread the original box into the result) so `prop`, `ry`, `decor` survive.
3. Patch `da.buildSet` (45064):
   - Skip `decor` boxes whose largest side is over 30 m (sky domes, water planes) unless `CrewExt.buildBox` returns a model for them; if it does, add the model but exclude it from fog-sensitive tricks. Check `web/classic/player.js` for exactly how the classic viewer treats them and match it.
   - For boxes with `prop`, use `CrewExt.buildBox(box)`; fall back to the current cube.
   - Indoor sets (`!set.open`): draw floor and back/side walls from `set.w`, `set.d`, `set.h` if the server bake has no wall boxes (the demo bake includes them as boxes tagged "floor", "back wall"...; the server bake does not). Match the demo's look (colours from `PC()` at line 13254).
   - Open sets: no walls; enlarge the ground plane and push fog out (the constructor builds an 80 x 80 plane and `Fv(725024, 22, 48)` fog).
4. `da.dispose` must dispose prop geometries/materials it added.
5. Headless check: extend `test/e2e/smoke.mjs` to load a show that includes `london_street`, `cafe` and `living_room` (write a throwaway show under the scratchpad and point the server at it, or patch via `PUT /api/episode`), and screenshot. Compare against `/classic/` screenshots of the same frame. Props must appear, no giant boxes, walls only indoors.

### Step 4. Audio: real voice clips, voices and writers' room

1. Patch `M4.start`/`M4.speak`: when an audio event has `src`, play it as an `AudioBufferSourceNode` through `this.master` at the right offset (fetch + `decodeAudioData`, cache by URL). Only fall back to `speechSynthesis` when there is no `src`. Also make the MP4 render's audio path (the `ZE(..., "offline")` mix near 53830) include clips; find where it mixes dialogue and add the buffers.
2. Lip sync: `audio[].lips` is base64, 4 bytes per frame at 30 fps (open, wide, round, emphasis). Find how `da` animates mouths (grep `talk`/`mouth`/`jaw` near `class eP`/`nP`) and drive mouth open from the track when present.
3. "Recording a voiceover" and "Syncing a voiceover and lip-sync" (J5): server mode calls `POST /api/voices` (body `{ engine?, force?, prune? }`), streams progress from SSE `crew` events, then refreshes state. Show `GET /api/voices` results (cast designs, per-line clip status) in a small modal; keep it to the show's own lines, never library voices.
4. "Breaking a script into shots" (59769): server mode calls `POST /api/write` with `{ script, apply: false }`, shows the returned episode as a take to accept (`apply: true`), then refreshes. Demo mode: keep the toast but say it needs the server.
5. Add `write` and `voices` to `Ji` (14701) so they go through `Cs`; in demo mode `Av.handle` must return a clear 503-style error for them (check how `FC.handle` reports "No ..." for `/api/mode` and copy that).

### Step 5. Deliver page exports (`q5`, `Y5`, J5 export rows)

All exports are client-side and built from `baked` (server: `ke.get().server.baked`) plus manual framing `qi`. Put shared helpers in `web/crew/exports/util.js`: `download(name, blob|string, type)`, `fps`, timecode `tc(seconds, fps)` (`HH:MM:SS:FF`), `cameraAt(t)` (see below), a tiny STORE-only zip writer (CRC32 + local headers + central directory; no compression, no dependency).

Camera per frame: don't reimplement the framing solver. Create a hidden `new __crew.Viewer(canvas)`, `setFixedSize`, `load(baked)`, `await ready()`, then for each frame call `frame(t)` and read `viewer.cam` (position, quaternion, fov, aspect). Honour "Include manual framing" by checking how `frame()` applies `qi` and toggling it. Sample at the project fps for the selected shots' cut ranges.

1. Camera exports (`web/crew/exports/camera.js`):
   - `.chan` (Maya/Nuke): one line per frame `frame tx ty tz rx ry rz`, rotations in degrees XYZ, plus a header comment with the film-back (36 x 24) and focal per frame in a sidecar `.txt` (Nuke reads vertical aperture separately; note it in the file).
   - Blender `.py`: script that creates a camera, sets sensor 36 x 24, keys location/rotation_euler (convert three's Y-up to Blender's Z-up: x, -z, y and rotate 90 degrees about X) and lens per frame, sets scene fps and frame range.
   - After Effects `.jsx`: creates a comp at the render size and fps, a 3D camera with position/point-of-interest/zoom keyframes (zoom from fov and comp height). AE is Y-down; convert.
   - glTF `.glb`: use `GLTFExporter` from `/vendor/three/addons/exporters/GLTFExporter.js` with a camera node and a keyframed animation clip (translation, rotation; fov via a `KHR`-free extras track or a separate scale trick; document what you chose).
   - FBX: no reliable browser writer. Wire the button to toast "FBX isn't supported in the browser. Use the glTF export; Unreal imports .glb." and remove it if the user later says so.
2. Storyboard (`web/crew/exports/storyboard.js`): frames per shot "1" (middle), "3" (start/middle/end) or "beat" (each beat's midpoint from `shots[].beats` if present, else lines with `t0`). Render with `__crew.still(baked, t, 1280, 720, assets)`. "Print / PDF" opens a print-ready window (grid, shot id, type, lens, move, dialogue under each frame, page breaks per scene) and calls `print()`. "Images (.zip)" zips the PNGs named `<shot>_<n>.png`.
3. Shot list (`web/crew/exports/shotlist.js`): CSV columns: scene, shot, type, subjects, lens, move, angle, light, cut in, cut out, duration, dialogue. "Group shots by camera setup" sorts by (scene, set, lens, camera position rounded to 0.5 m) and adds a setup number column. "Print shot list" is the same as an HTML table in a print window.
4. Overhead plans ("Print plans"): per shot, a top-down SVG: set rectangle (w x d), furniture/prop boxes as rotated rects with prop titles from `PROPS` meta if loaded, anchors as dots with names, actor start/end marks and walk paths (from the bake's per-actor tracks; find the field), camera position and a view cone from `cameraAt(mid)`, and the 180 degree line between the two main subjects. One shot per page.
5. Phone shoot pack: a single self-contained HTML file (inline CSS/JS, frames as data URIs) that shows the shot list and, per shot, the previs frame as a translucent overlay on `getUserMedia` camera video, with the chosen frame lines and optional edge outlines (Sobel on the still, drawn as white lines). Must work offline from the phone's files app.
6. Editorial (`web/crew/exports/editorial.js`):
   - OTIO: server mode `GET /api/otio` (already wired? confirm; if the button is a `ti` stub, hook it to download the server response). Apply handles and take letters if the server ignores them (post-process the JSON).
   - EDL: CMX 3600, one event per shot, reel `AX`, clip name comment `* FROM CLIP NAME: <shot id> <label>`, source in/out with handles, record in/out from cut times.
   - Final Cut XML: FCP7 XML (xmeml v5) sequence with one clipitem per shot referencing `<shot>.mp4` files and the same timings, so it pairs with "Clips per shot".
   - Clips per shot (.zip): reuse the MP4 render (~53920) per shot range, zip them. If memory is a concern, render and add one shot at a time.
   - "Compare with editor's cut…": accept an EDL or OTIO upload, match events to shots by clip name, and show a table of per-shot duration differences; offer an editor-role patch (`trim`/`hold`) via `Ji.patch(text, "editor", true)` dry run, then apply.
7. J5 export rows:
   - SRT and YouTube chapters from `baked.audio` (`type: "say"`) and scenes. Chapters: `0:00 <scene title>` per scene; YouTube needs the first at 0:00 and at least 3 chapters of 10 s or more, so warn otherwise.
   - PNG sequence, WebM with alpha, ProRes 4444: PNG sequence = zip of `C4` stills per frame (warn on size). WebM alpha via `VideoEncoder` with `vp09` and `alpha: "keep"` if `isConfigSupported` says yes, else explain. ProRes: not encodable in the browser; toast that and point to the PNG sequence.
   - Frame export: `C4` at the current `Me.t`, current size preset.
   - "Rendering every size": run the existing MP4 render once per checked size preset (`Z5`: 16:9, 9:16, 1:1, 4:5). Find how the render picks aspect and framing (the "Each size gets its own framing" note) and reuse it.

### Step 6. The remaining stubs

Wire each or replace it with an honest message. Keep each one small.

1. Fitting the cut to a target length (J5, target `b` seconds): compute the current length, then build an editor-role patch that trims shots proportionally (respecting dialogue, never cutting inside a `say`; use beat times), dry run with `Ji.patch(patch, "editor", true)`, show the result, apply on confirm. Alternative in server mode: send a note "Fit the cut to N seconds" through `Ji.note` and let the crew do it. Prefer the note (it uses the real crew and guard); fall back to the local patch in demo mode.
2. Lower-third title cards: overlay text per character on first appearance during render and preview (canvas 2D drawn onto the render canvas before encoding; in preview, a DOM overlay over the viewer). Store settings in `ke` or localStorage.
3. Placing your logo on renders: keep the uploaded image as an object URL; draw it in a corner during MP4/PNG render. Corner and opacity from the existing controls.
4. Thumbnail maker: pick the frame with the closest subject (largest face in frame; approximate with the shot with the tightest `size`) and render at 1280 x 720 with the title overlaid; let the user scrub to choose another frame.
5. Focus pulls: needs depth of field. If the viewer has no DOF pass, implement a cheap one only if time allows; otherwise toast "Needs depth of field in the viewer; not built yet." Do not leave the generic stub.
6. Auto-reframing every shot: for each non-16:9 size, compute per-shot framing offsets so subjects stay centred (project subject head positions with the shot camera, shift `truck`/`ped` in `qi` style overrides per size). Store per size, not in the 16:9 `qi`.
7. Syncing footage over the previs: load the user's video into a `<video>` element and composite it over the viewer with an opacity slider, time-locked to `Me.t`. Local only, nothing uploaded.
8. Dragging beats to retime (50286): convert a drag on a beat in the timeline into a token edit `<addr> ~old -> ~new` and dry run, then apply as the role that owns the line (look up ownership in `ke.get().server.grammar` or by verb).
9. Starting from a template / The scene library: offer a fixed list of starter episodes built from the library sets (`include living_room` etc.) as SCENE text, applied with `Ji.putEpisode(source)`. This is allowed because it is a starter list of the show's own SCENE text, not a browser of library assets. Do not list props, characters, music or voices.
10. Crew style (K5): replace the fake "Example values" with real stats from `ke.get().server.history`/`notes` (accepted vs rejected takes: average shot length in accepted versions, most common shot types and moves). "Reset style" clears whatever taste the server keeps if there is an endpoint; there isn't one today, so add `POST /api/taste/reset` only if `src/crew` has a taste store you can clear safely, else toast honestly. "Add a reference scene" stays a toast: analysing video is out of scope.
11. Creating a review link: the server is localhost only. Toast "Review links need a hosted server." unless there is one. Do not invent hosting.
12. Projects (switch, rename, duplicate, archive): the server serves one show. Wire "Switching projects" to switching episodes (`p.episodes` from state plus a new `POST /api/open { episode }` if the server lacks one; check `Crew` in `src/index.ts`). Rename/duplicate/archive: toast "One show per server for now." Keep it honest.
13. "Checking a cut against the editor's timeline" is covered in 5.6.

### Step 7. Tests, docs, commit

1. Make `test/e2e/smoke.mjs` runnable as `npm run e2e` (not part of `npm test`, since it needs Chromium). It should click every Deliver/Create button and assert no "isn't wired up yet" toast appears, except for the honest messages listed above, and that downloads arrive for every export.
2. Unit tests for pure helpers (timecode, EDL writer, CSV, SRT, zip writer CRC) as `test/web-exports.test.ts`, importing from `web/crew/exports/*.js` (keep those helpers DOM-free so Node can run them).
3. Update `docs/FRONTEND_PROMPT.md` (the brief now describes v9 + `web/crew/` hooks), `docs/HANDOFF.md` (what's wired, what's honest-toast, the CREW-EXT patch list), `README.md` (`/classic/` exists, `npm run e2e`).
4. `npm test`, `npm run typecheck`, `npm run e2e`. Commit per step; push to the branch.

## Things to watch

- `web/app.js` is huge. Never rewrite it wholesale or re-run prettier over it after patching (diffs become unreadable). Use targeted edits.
- The demo backend (`FC`) has its own copy of the SCENE language. Don't try to keep it in sync with `src/scene`; demo mode is a fallback.
- Server bake vs demo bake differences are the most likely source of breakage. Log them in HANDOFF as you find them.
- Memory: video and PNG-sequence exports can be large. Stream into the zip/muxer per frame and release canvases (`viewer.dispose(true)`).
- Respect `$u()` (demo mode) in every server call path.

## Appendix: CREW-EXT patch list

Keep this in sync with `grep -n "CREW-EXT" web/app.js`.

- 49108 `sn` dispatches to `CrewExt.handlers`; `Fp`/`ds`/`ti` pass section titles and `ctx` (options in scope at each call site)
- `sP` keeps the whole box; `da.buildSet` uses `CrewExt.setBoxes` (walls, drop giant decor) and `CrewExt.buildBox` (library models), rotates plain cubes by `ry`
- end of file: `window.__crew` exposes store, api, toast, go, demo, Viewer, still, clock, audio, framing, sp
