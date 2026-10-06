# Prompt: design and build the Crew frontend

You are designing and building the web frontend for **Crew**, an AI film crew that takes direction. A director writes notes like "1D 0:03, too long" and a crew of Claude agents returns 2-3 checked "takes" that change exactly what was asked and nothing else. The film is source code (the SCENE language) compiled into a 3D animatic. The backend is done: you own everything in `web/`. Do not change `src/` except to report an API gap.

## Product feel

This is a professional tool for directors, closer to an edit suite (Avid, Resolve, Frame.io) than to a chatbot. It should be dark, calm and dense, with the picture as the hero. Typography is precise. Timecode is always visible. One accent colour works as a "tally light", for record and active state. The crew should feel like people on set: roles, models and costs are visible but quiet. The director never has to see code unless they open the Script tab.

The core loop has to feel instant and safe:
1. Watch the cut.
2. Type a note, or click a shot and timestamp to pre-fill one.
3. The crew works, with live activity showing who is doing what on which model and what it costs.
4. 2-3 takes come back, each with a one-sentence purpose. The recommended take is highlighted.
5. Preview any take in the viewer. Changed shots are highlighted on the timeline, and A/B against the current cut is one keypress.
6. Accept, which is undoable, or reject or follow up. Optionally rate the result better or worse (blind rating feeds the north-star metric).

## Run it

```bash
cd ~/Projects/crew && npm install && npm start
```

That serves `web/` at http://localhost:4310. Offline mode (no API key) uses deterministic heuristics, so every flow works without Claude. With `ANTHROPIC_API_KEY` set, Claude does the work. Static files come from `web/`, three.js from `/vendor/three/three.module.js`, mp4-muxer from `/vendor/mp4-muxer/mp4-muxer.mjs`, and assets from `/library/...` (see Characters, and Sets, props and set dressing). No bundler is required. Plain ES modules are fine, and so is a build step whose output lands in `web/`.

## What exists today (keep or replace)

The current `web/` is a working but plain prototype. Treat it as a reference for the data flow, not the design:
- `player.js`: three.js renderer that plays baked frames, with toon shading, ink outlines, a procedural rig and canvas-drawn faces. **Keep its contract:** `new Player(canvas)`, `load(baked)`, `frame(t)`, `setFixedSize([w,h]|null)`.
- `audio.js`: Web Audio sfx, music and ambience, TTS dialogue live, and offline rendering for export.
- `export.js`: WebCodecs MP4 export with a test run, projected time, parts cut on shot boundaries, and resume.
- `app.js`, `index.html`, `style.css`: the UI. Redesign these freely.

## API (JSON over HTTP, same origin)

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/state` | | `{title, episode, episodes[], source, showSource, addresses[], baked, qc, grammar[], history[], notes[], metrics, mode, pipeline, shots[], assets}` |
| POST | `/api/note` | `{note, parent?}` | NoteRecord. Takes a few seconds with Claude, so show progress from SSE. |
| GET | `/api/preview?note=&take=` | | `{baked, changedShots[], source}`: the cut with that take applied |
| POST | `/api/accept` | `{noteId, takeId}` | `{ok, history}` |
| POST | `/api/reject` | `{noteId}` | NoteRecord |
| POST | `/api/rate` | `{noteId, rating: "better"\|"worse"}` | NoteRecord |
| POST | `/api/patch` | `{patch, role, dryRun, allowSpill?}` | Evaluation `{ok, committed, reasons[], changes[], changedShots[], spill[], newIssues[], fixedIssues[]}` |
| PUT | `/api/episode` | `{source}` | `{ok, grammar[]}` |
| POST | `/api/undo` | | `{undone}` |
| POST | `/api/write` | `{script, apply}` | `{ok, text, errors[], cost}`: the writers' room (needs Claude) |
| POST | `/api/screen` | `{viewers}` | `{viewers[{persona,wants,understood}], shots[{id,confusion,boredom,notes[]}], understoodShare, cost, mode}` |
| GET | `/api/otio` | | OpenTimelineIO JSON of the cut |
| POST | `/api/mode` | `{llm?: "claude"\|"offline", pipeline?: "full"\|"fast"}` | `{mode, pipeline}` |
| GET | `/api/events` | | SSE stream. `event: crew` sends `{kind, role, tier, model, message, cost, tokens, ms}`. `event: changed` means reload state. |

Errors come back as `{error}` with a 4xx or 5xx status. Show them plainly.

### Key shapes

- **NoteRecord:** `{id, note, targets[], roles[], intent, takes[], message, pushback|null, idea|null, rejected[{tier,reason}], status: open|accepted|rejected|needs-shot|failed, round, cost, ms, mode, rating?}`
- **Take:** `{id, purpose, patch, roles[], tier: haiku|sonnet|opus, model, changedShots[], fixed[], added[], score}`. `takes[0]` is the recommended take.
- **qc:** `{issues[{check, severity: error|warn|info, shot, addr, local?, message}], checked[], notChecked[], counts}`. `local` is seconds into the shot. Every publish must show the checked and not-checked lists.
- **baked:** `{fps, duration, cast{id:{name,height,color,voice,model?}}, sets{id:{w,d,h,open,boxes[],anchors[],props[]}}, palettes, expressions[], gestures[], shots[], audio[]}` (box and prop fields: see Sets, props and set dressing)
  - **shot:** `{id, label, type, subjects, lens, move, speed, light, palette, cutStart, cutDur, trimHead, trimTail, hold, dur, worldStart, beats[{addr,t0,t1,kind,label}], hash, cam[[px,py,pz,tx,ty,tz,fovV]], chars{id:[[present,x,z,yaw,head,pose,poseAmt,expr,talk,gesture,walk]]}, props{id:[[x,y,z,holderIdx,open]]}}`
  - Frames start at `cutStart` at `fps`. Characters are baked on twos. `gesture` is an index plus progress. `walk` is the gait phase, or -1.
  - **audio:** `[{t, shot, addr, type: say|sfx|music|ambience|silence, dur, name?, char?, text?, verb?, voice?, clipped?, src?, lips?}]` in cut time (`src`/`lips`: see Voices, dialogue clips and music).
- **metrics:** `{notes, closed, resolvedFirstRound, resolutionRate|null, cost, costPerNote}`
- `addresses[i]`: the SCENE address of source line `i` (for example `1D.2`), so the script view can show addresses in a gutter.

## Screens and must-haves

1. **Viewer.** 16:9 letterboxed. Overlays for shot id, label, lens and move; timecode HH:MM:FF; subtitles with speaker colour; a "PREVIEW · TAKE B" banner. Toggles for thirds/safe guides and mute. Optional free-orbit "set view" for inspecting blocking from above, using `sets[].boxes` and character positions.
2. **Timeline.** Shot blocks with width proportional to `cutDur`, scrubbable by pointer. QC markers placed at `shot.cutStart + (local - trimHead)`, coloured by severity. A dialogue lane in cast colours, sfx ticks and music bars. A screening heatmap lane (red for boredom, blue for confusion). Changed-shot highlighting during previews. Click a shot plus a time to prefill the note box with `"1D 0:03, "`.
3. **Notes.** Input with example chips. Live crew activity while working. A result card showing message, pushback (amber), takes (letter, purpose, patch in mono, chips for changed shots / fixes / new issues / model tier), and the idea (blue). Preview, Accept, None of these, and Follow up (which sends `parent`). Recent notes with status and better/worse rating. A `needs-shot` status should prompt for a shot ID.
4. **Script.** SCENE source editor with an address gutter and grammar errors inline; save sends PUT. A patch box with a role select, Dry run and Apply, showing the evaluation (permission and locality rejections explain themselves, so render `reasons` prominently). The show bible is read-only.
5. **QC.** Counts; issues that seek to their moment on click; checked and not-checked lists; test screening.
6. **Crew.** A live log with tier colours (haiku, sonnet, opus), cost and ms; the change history with undo.
7. **Export.** Uses `export.js` as-is: size, parts, burn-ins, resume-from-part, Test run (required before Render), progress with ETA, and part downloads. Also links for OTIO, baked JSON, SCENE and still PNG.
8. **Header.** Show and episode; a crew-mode toggle (Claude or Offline); the pipeline (full or fast); a QC chip; the **note resolution rate** (the north star); total cost; Undo.

Keyboard: space play/pause, ←/→ frame step, ↑/↓ previous/next shot, Esc to leave a preview, N to focus the note box, ⌘Z to undo.

## Sets, props and set dressing (assets)

Sets are no longer plain grey boxes. A show pulls in ready-made sets with `include cafe` (ten exist: boarding_room, library_corner, staffroom, veranda_corridor, classroom, living_room, office, cafe, london_street, park) and every piece of furniture, dressing and named prop is a real 3D model from the prop library. The library is backend-only: there is no browse API and you must not build a library page. You only ever draw what `baked` tells you to.

**What `baked.sets[id]` carries now**

```
{ w, d, h, open, anchors[{id,x,z,face,furniture}], props[{id, kind}],
  boxes[{ id, kind, prop, cx, cy, cz, w, h, d, yaw, ry, y, sittable, solid, decor, dress, scale }] }
```

- `open: true` is an outdoor set (london_street, park): draw **no walls and no ceiling**, put the sky behind it, and treat `w`/`d` as the playable rectangle. `h` is 80 for open sets, 2.7 for rooms.
- `boxes` is everything to draw, in metres, world space, y up, +z toward the default camera. Each box is one library model: `prop` is its model id (never null, so always draw a model), `kind` the SCENE word that placed it. Set `dress: true` marks set dressing (no stand mark); `dress: false` is furniture belonging to an anchor.
- Place the model with `ry` (rotation about y, radians; the model's front faces +z at 0) at `(cx, y, cz)`. `y` is the elevation of the model's origin (0 on the floor, the table height for a mug dressed on a table). `buildBox(box, THREE)` does all of this, including centring the model on the box and fitting the footprint; use it.
- `decor: true` boxes (rugs, posters, clocks, mugs, trees, skies, water) are drawn but are not obstacles. `solid: false` boxes are doors and windows. QC and the camera solver already use the same boxes, so what you draw is exactly what is checked. Never move or resize a box.
- `props[].kind` is the library model for a story prop (`mug`, `leather_book`, `cake`...); `baked.shots[].props[id]` still gives its per-frame `[x,y,z,holderIdx,open]`. Parent it to the holder's hand when `holderIdx >= 0`, and call the model's `open(angle)`/`cover` hook when `open` is 1. A prop with `kind: null` (`fridge.door`) is a part of furniture: animate the matching box instead (the fridge model has `userData.open(angle)`).

**Using the models**

```html
<script type="importmap">{"imports":{"three":"/vendor/three/three.module.js","three/addons/":"/vendor/three/addons/"}}</script>
```
```js
import * as THREE from "three";                       // the SAME module instance as player.js, or instanceof breaks
import { PROPS, buildProp, buildBox } from "/library/props/index.js";
const model = buildBox(box, THREE);                   // a Group, already placed
scene.add(model);
```

- `GET /api/state` returns `assets.props = { registry: "/library/props/index.js" }`. Builders are cheap for furniture and a little heavier for landmarks, so build each set once when it first appears and cache it (the player already rebuilds only when `shot.set|palette` changes).
- Models use `MeshStandardMaterial` with real colours. The animatic's look is toon with ink outlines: either keep the standard materials and add an outline pass, or swap materials per mesh (`group.traverse`). Do not lose the colours; the film props are art-directed. `palettes[...]` still tints floor, walls and key light; models keep their own colours.
- Some models carry lights (`bedside_lamp`, `bankers_lamp`, `floor_lamp`, `street_lamp`, `fridge`, `elixir_bottle`). Keep them for `light practical` shots, and cap the number of live point lights (about 8) by switching off those far from the camera.
- Animated models expose hooks on `group.userData`: `update(t)` (ceiling_fan, wall_clock, elizabeth_tower, london_eye, union_jack, water_thames, steam, f16 with `{burn, vapor}`), `set(state)` (traffic_light, sky_campus), `pulse(t)` (elixir_bottle), `open(angle)` (door, fridge). Drive them from the playhead time so scrubbing is deterministic. Skies (`sky_london`, `sky_campus`) are dome meshes at radius 400 m: centre them on the camera and set `scene.background = null`.
- `userData.prop = { id, ... }` on every model names it. The model library has no per-instance randomness: the same id always looks the same.

**Set dressing in the Script tab.** `show.scene` gains two things the director may see in the source: `include <set>` and `dress <prop> at x z [face d] [height y | on anchor] [scale s]`. `GET /api/state` `grammar` (and `showSource`) will show them, and parse errors for them come back in `grammar` like any other. The source is read-only in the UI, so render them as a tidy "Set" list (set name, dressed items by name) if you want to show them, but never expose a catalogue to pick from.

**QC additions.** Two new `check` values appear in `qc.issues`: `furniture` now also covers dressing ("kiran is inside the dining_table"), and `seat` (warn) means someone sits with no chair, sofa or bed under them. Show them like any other issue.

## Voices, dialogue clips and music

- Each `baked.audio` event of `type: "say"` may carry `src` (URL of the rendered clip, under `/show-media/voices/`) and `lips` (base64, 4 bytes per frame at 30 fps: open, wide, round, emphasis). When `src` exists play that clip at the event's cut time instead of browser TTS; when it doesn't, fall back to TTS as before. Dialogue timing in `baked` already uses the real clip duration, so a clip always fits its window.
- The player already drives mouths from `lips`-derived `talk` values in the baked character channel; do not recompute them. `GET /api/voices` lists the bank, `POST /api/voices` renders missing clips (engines: kokoro, walla offline, command), with `{force, prune}`; give the director one "Render voices" button in the Export or Crew tab with progress, because it can take a minute per episode with Kokoro on first use.
- Library music (`odyssey_score`, `the_bob_score_real`) is not wired into SCENE yet: `music <cue>` events are still the synthesised cues and nothing in `baked` points at the scores, so build no UI for it.

## Characters (assets)

`GET /api/state` includes `assets.characters`: `{male: "/library/characters/makehuman_male/human_male.glb", female: "/library/characters/makehuman_female/human_female.glb", rig: "/library/rigs/makehuman.json"}`. Each cast member may name a `model` (male or female) in `baked.cast`. The GLBs are MakeHuman-style rigs: 163 joints (`root`, `spine01-05`, `neck01-03`, `head`, `upperleg01/02_L/R`, `lowerleg01/02`, `foot`, `clavicle`, `shoulder01`, `upperarm01/02`, `lowerarm01/02`, `wrist`, fingers, and face bones `jaw`, `eye_L/R`, `oris*`, `levator*`, `orbicularis*`). They are textured, with no animations or morph targets. `rig` (the JSON at that URL) gives the bone mapping from Crew's pose channels (hips, spine, neck, head, arms, legs, jaw, eyes) to these joint names, plus the model height. Drive them from the same baked channels the procedural rig uses (gait phase, pose, gesture, talk to jaw open, head yaw to neck and head, eye blink with the lids). Keep the procedural rig as a fallback when a GLB fails to load. Use `GLTFLoader` from `/vendor/three/addons/loaders/GLTFLoader.js`. Characters should read stylised and not uncanny. Consider toon or NPR material overrides with ink outlines, so they match the grey-box sets.

## Quality bar

- Never block the UI. Notes take seconds, so stream activity and keep playback running.
- A preview must never be mistaken for the real cut, so make the banner and timeline unmistakable.
- Results first, short. Show what was checked and what wasn't.
- Make it responsive down to a laptop at 1280px wide. A phone gets a "review mode" (viewer, timeline, notes) and no editor.
- Accessibility: focus states, aria labels on icon buttons, and colour is never the only signal.
- Verify in a real browser: play the demo, give the five example notes in offline mode, preview and accept a take, undo, run screening, do an export test run, and check the console has no errors.
