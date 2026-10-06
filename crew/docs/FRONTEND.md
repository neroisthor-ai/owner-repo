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
