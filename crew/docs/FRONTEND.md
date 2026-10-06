# The frontend (v9), as built

`web/` is the v9 build the user supplied (a Vite/React/Tailwind bundle, three.js r186 inside), made the real frontend. The old vanilla viewer is kept at `/classic/` (`web/classic/`) for comparison; do not extend it.

## Layout

| Path | What |
|---|---|
| `web/index.html` | shell: importmap (`three`, `three/addons/`), then `crew/boot.js` |
| `web/app.js` | the bundle, prettier-formatted. There is no other source: this file IS the source. Names are minified (`ke` store, `da` viewer, `sn` stub dispatcher...). |
| `web/app.css`, `web/crew-ui.css` | Tailwind output and the v9 overrides |
| `web/crew/boot.js` | creates `window.CrewExt`, loads the add-on modules, then imports `/app.js`. A module that fails to load never stops the app. |
| `web/crew/props.js` | library props in the viewer (see below) |
| `web/crew/voice.js` | rendered dialogue clips, user voiceover, Render voices, writers' room |
| `web/crew/render.js`, `render/*.js` | the film look and the part renderer (see below) |
| `web/crew/exports/*.js` | every export: camera, storyboard, shot list and plans, editorial, media |
| `web/crew/create.js`, `style.js` | Create page extras, Crew style, retiming |

**Rule: features live in the readable modules, not in `app.js`.** `app.js` only carries small patches marked `// CREW-EXT:` (`grep -n CREW-EXT web/app.js`). Each one calls into `window.CrewExt` and degrades to the bundle's own behaviour if the module or the server is missing. Demo mode (no server, `$u()` true) still works.

## Design: modern pro

`web/ui.css` is the whole look. The reference is today's pro apps (Final Cut Pro 11, Logic, the macOS system apps): a quiet charcoal canvas, panels as softly rounded sheets (10px) with 6px of air between them, a title bar and a toolbar on top with the pages as one segmented control, native-feeling controls (macOS segmented controls, filled buttons, soft fields with a blue focus ring), one blue for selection and primary actions, and timeline colour that means something: indigo picture, green sound, red playhead and errors. No gradients or glows; vibrancy only on menus, the palette and toasts. It re-themes the bundle through its own Tailwind colour variables, then restyles components. The one layout change moves the page bar from the bottom into the toolbar with flex `order`. `crew-ui.css` keeps only the v9 layout rules; the home page shows the project instead of a slogan (a `CREW-EXT` patch).

The title bar is deliberately plain: `crew / Show · Episode N` on the left; on the right one **Crew AI menu** (`CrewMenu` in `app.js`: who does the work, how thorough, project type, each with a one-line explanation), an issues count only when there are issues, search, undo, Share and Help. The model is branded **Crew AI** everywhere the user sees it. **Deliver** is two tabs (`ke.deliverTab`): Render (the render panel, "Check before you render", the crew log) and Export (every package as a card). Each page shows a one-line hint in the toolbar, and the advanced inspector sections (camera body, depth of field, film look, vertical, controls) start collapsed so a beginner sees the essentials first.

## Features beyond the original buttons

- **Film look panel** (Frame page, bottom of the inspector): a named grade (The Bob's: golden afternoon, library, rain, night, black and white...) or auto from the shot's lighting, then exposure, bloom, halation, contrast, saturation, vignette, grain, fringe and light streaks, per shot or for the whole film, plus the atmosphere switches. Model: `CrewExt.lookPanel` (`web/crew/render.js`); `resolveGrade()` in `render/look.js`.
- **Client package** (Deliver > Other formats, or the palette): shot list, EDL, Final Cut XML, OTIO, captions, chapters, every camera file, storyboard frames and the shoot pack in one zip with a README and the QC summary. Exports write into `util.sink` while it runs.
- **Project backup**: show, episode, notes, history, the baked cut and the dialogue clips in a zip.
- **Ask the crew to fix this** on every QC error and warning, and "fix every QC error" in the palette: the issue goes to the crew as a note.
- **Waveforms** on the dialogue track, from the rendered clips.
- **Command palette** (Cmd/Ctrl+K) carries the new actions: look on/off, quality, depth of field, passes, atmosphere, client package, backup, voices, editorial exports, captions, frame, name cards. **F** toggles a fullscreen viewer.
- **Set shells** (`web/crew/shell.js`): every closed set gets a floor, four walls (one-sided, so the Set view still looks in), skirting, a picture rail, a dado where the style has one, a ceiling with practical lights; streets get asphalt, a kerb, paving, lane markings and a zebra crossing at the `crossing` anchor; parks get grass and a gravel path. Styles are chosen from the set id (kitchen, cafe, living, office, classroom, library, staff, corridor, room) with a default; all textures are procedural.

## One home for every feature

A feature lives on one page and is not repeated. The map:

| Where | What |
| --- | --- |
| **Home** | New project: script, **3D set or 2D backdrop**, inspiration pictures; templates; project type (sidebar) |
| **Review** | Watch, notes, takes, comments, the issues list |
| **Edit** | The timeline and your own media: media pool, Source monitor, clips on V2/V3 and A3/A4, split, trim, drag, green screen, voiceover, voices |
| **Frame** | Camera, lens, focus, reframe, **film look and quality, framing guides** (the viewer's Look, Draft/High/Ultra, Thirds and Safe appear only here) |
| **Plan** | Every shot at a glance |
| **Deliver > Render** | Size, passes, burn-ins, the pre-render check, the crew log |
| **Deliver > Export** | Every file: the whole project (client package, backup, baked JSON, SCENE source, current frame), camera files, storyboard, shot list, editorial, shoot pack |
| **Title bar** | Crew AI menu (who does the work, how thorough), search, Undo (timeline edits first, then the crew's changes), Share |

## Editing on the timeline (`media.js`, `editui.js`, `keying.js`)

Your own sounds, pictures and footage sit on extra tracks on top of the cut: **V3/V2** over the picture, **A3/A4** for audio. The crew still owns the shots and their dialogue; this layer never changes the scene source. Clips persist per project in localStorage, the files in IndexedDB (`crew-media`).

- **Import** in the Edit page's Media pool, or drop files on the timeline. Click a file to preview it in the Source monitor; double-click to add it at the playhead.
- **On the timeline**: drag to move (snaps to the playhead, cuts and other clips), drag an edge to trim, **S** splits at the playhead, **Delete** removes. Tracks appear as you use them.
- **Inspector** (Edit page, top): fades, volume, size and position, opacity, and the green screen controls. **Key out a colour** finds the screen from the first frame; Reach, Soft edge and Remove spill tune it. The key works in chroma (`keying.js`), so a shadowed screen keys like a lit one.
- **Voiceover**: Record puts the take on Your audio at the playhead. **Voices** renders the cast's dialogue (needs the server).
- Playback and renders both include it: the live viewer draws an overlay canvas over the program monitor (`CrewExt.viewerHooks`), the renderer composites after each frame (`CrewExt.overlayUser`) and the mixdown adds the audio (`mixUser`).

## New project: 3D or 2D set (`setui.js`, `setlook.js`)

The script box on Home has a **Set** choice. **3D set** takes up to six inspiration pictures and shapes the procedural set from them: wall, floor and ceiling colours, light tint and level, and the room style when the set's name gives none. **2D backdrop** takes one picture and wraps it round the set as a mirrored ring, so every camera angle sees it; the actors stay 3D. The choice is a draft until the writers' room makes the episode, then it is stored for the project (`CrewExt.setLook`). The asset library itself stays backend-only.

## The hook layer

- `sn(what, ctx)` was the "isn't wired up yet" toast. It now runs `CrewExt.handlers[what](ctx)`; `ctx` is the options on screen at the call site (selected shots, frames per shot, handles, passes...). `CrewExt.on(what, fn)` registers a handler. `CrewExt.wired(...sectionTitles)` hides a section's "not wired" badge.
- `window.__crew` exposes the bundle's internals to the modules: `store`, `api`, `toast`, `go`, `demo()`, `Viewer`, `still`, `clock`, `audio`, `look()` / `setLook()` (the framing panel settings: body, DOF on, f-stop), `three` (the bundle's own three.js classes, needed for render targets and shaders), `burn`, `mixAudio`.
- `test/e2e/stubs.mjs` fails if any button the bundle routes through `sn()` has no handler.

## Sets and props

`CrewExt.setBoxes(set)` adds the floor and three walls for closed sets (the server bake has none) and drops giant decor; `CrewExt.buildBox(box)` returns the library model (`/library/props/index.js`, loaded by known path only: the library is never browsed). Plain cubes are rotated by `ry`. Library sky models are replaced by the atmosphere's sky while the look is on.

## The film look (a port of The Bob's pipeline, plus Low Pass's atmosphere)

`web/crew/render/look.js` is The Bob's post pipeline (`library/reference/the_bob/index_master.html`): HDR scene target, auto exposure (centre-weighted log-luminance meter), bloom and halation, depth of field from the depth buffer, chromatic aberration, sun flare, ACES, lift/gain, split toning, saturation, contrast, vignette, FXAA, grain. The shaders are The Bob's. `grades.js` holds its grades and maps Crew's light moods onto them.

- **Real time:** the **Look** button in the viewer header toggles it; **Draft / High / Ultra** is The Bob's quality tier (pixel ratio and DOF taps). Single pass, lens blur and anti-aliasing in the shader.
- **Passes per frame** (Deliver > Render): The Bob's accumulation renderer. Per frame: lens-disc jitter (true depth of field from the f-stop and focus), sub-pixel jitter (anti-aliasing), motion blur over a 180 degree shutter in time slices, with a per-frame budget so a still shot doesn't pay for blur it doesn't have. Halton sequences.
- **Depth of field** is the Frame page's panel (`dof`, f-stop, focus subject, focus pull). Focus pulls are stored per shot in `CrewExt.look.settings.focus`.
- **Atmosphere** (`atmos.js`, from Low Pass): procedural sky per mood, volumetric clouds (ray-marched worley noise, Henyey-Greenstein, powder term), height haze, god rays, screen-space occlusion, anamorphic streaks off bright lights at night, lens dirt catching the sun. Open sets only for sky, clouds, haze and rays; occlusion on every set. Tiers: Draft none, High occlusion + haze + rays, Ultra adds clouds (always all of it in renders).
- **Encoder** (`encode.js`, The Bob's `renderFilm`): H.264 with hardware first, then software, then VP9; AAC then Opus; chunked streamed muxing; keyframe every 2 s; encoder back-pressure; MessageChannel yields so it keeps full speed in a background tab; wake lock; context-loss detection. One call renders one part; the bundle's own Render panel does the parts, test run, resume and cancel.
- **Other sizes** (`reframe.js`): 9:16, 1:1, 4:5 render the shot with its 16:9 camera and cut a window out via the camera's view offset, following the subject (eased), or a fixed crop position.
- **Mattes** (`exports/media.js`): PNG sequence with transparency is a difference matte (the frame on black and on white), a green screen hides the set, "blurred set" composites sharp characters over a blurred render.

## What each button does, and what it honestly can't

Wired: camera exports (.chan, Blender .py, After Effects .jsx, glTF), storyboard (print, zip), shot list (csv, print, grouped by camera setup), overhead plans (SVG per shot with marks, paths, camera cone, 180 degree line), phone shoot pack (one offline HTML: shot list, frame overlay on the live camera, edge outlines), OTIO / EDL / Final Cut XML with handles and take-letter naming, per-shot clips (zip), compare with an editor's EDL/OTIO (and match your cut to theirs), SRT, YouTube chapters, frame PNG, PNG sequence, every social size, name cards, logo, thumbnail maker, fit to length (as a note to the crew), starter episodes (built from the show's own set and cast), scene navigation, footage overlay, voiceover record/upload, Render voices, script to shots (writers' room), crew style from real notes, reference scene cut-rate, reframing, retime by dragging a beat's right edge, focus pulls.

Honest messages instead of features (and why): **FBX** and **ProRes 4444** (no browser writer; use glTF / PNG sequence), **WebM with alpha** (no WebM muxer in the app; use the PNG sequence), **review links** (needs a hosted server), **switching / renaming / duplicating / archiving projects** (one show per server), **"Browse scenes…"** shows only this episode's own scenes (the asset library stays backend-only).

## Tests

`npm test` covers the DOM-free code (`test/web-exports.test.ts`: formats, camera maths against three.js, grades, environments, sampling). `npm run e2e` runs the browser suite against a throwaway server on `shows/sets` (needs Chromium; `PW_NODE` and `CHROMIUM` env vars point at Playwright and the browser; software GL is fine): button handlers, the look on every shot, the atmosphere, clips decode, every export downloads, mattes and the vertical render, and an MP4 rendered at 1 and 8 passes. `node test/e2e/clips.mjs` runs the per-shot clips zip at a small size (the 720p version is too slow for software GL).

## Physics

`library/physics/` (pure JS, deterministic, no three.js): Odyssey's buoyant hull and ocean surface, Low Pass's flight paths, spray and trails. Tested in `test/physics.test.ts`. It is a library: SCENE does not use it yet (see HANDOFF).
