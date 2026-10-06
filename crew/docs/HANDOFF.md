# Crew: handoff for the next session

Read this first. Then `CLAUDE.md`, `README.md` and `docs/FRONTEND_PROMPT.md`.

## What Crew is

An AI film crew that takes direction. A film is SCENE source compiled into a 3D animatic. Director notes become 2-3 checked "takes" from a crew of Claude agents:

- Haiku proposes, Sonnet refines, Opus picks.
- Each role can only edit its own line types.
- A locality guard rejects any change that leaks into other shots.
- QC is done in code.

The original pitch and plan were pasted by the user in the first session: SCENE language, crew roles, rendering, QC, features, market and roadmap.

## Hard constraints from the user

- **The asset library is backend-only.** There is no user-facing library page and no browse API. It is used by the crew, the CLI and MCP (Claude). (A library viewer page was built and then deleted at the user's request.) The server still serves raw files under `/library/*` because the animatic needs them; the user hasn't decided whether to lock that down further.
- **The frontend is being designed by another AI** using `docs/FRONTEND_PROMPT.md`. This session owns the backend and assets. Don't redesign `web/` beyond keeping it working.
- **Voice clips from The Bob were deleted on purpose.** Keep the voice method as a feature (`src/voice/`), not the clips.

## Environment facts

- The project is at `~/Projects/crew`: Node 22, TypeScript run by `tsx`, no build step.
- `git` and `python3` are blocked by the Xcode licence (`sudo xcodebuild -license`), so nothing is committed.
- No `ANTHROPIC_API_KEY` is set, so the offline crew runs by default. Real Claude calls have never been run live; they are tested against a mock client.
- Kokoro TTS works in Node via `kokoro-js`. The model downloads on first use to the Hugging Face cache.
- The previous projects' originals are in `~/Downloads`:
  - `the-bob-previs-everything.zip` (unzipped copy in a session scratchpad, so re-unzip it)
  - `low-pass.html`
  - `Odyssey.html`
  - `human_male.glb` and `human_female.glb`, already moved into `library/`
- `~/.claude/launch.json` defines a `crew-dev` preview server pointing at a scratchpad show copy, which may be gone. Recreate it, or run `npm start`.

## Commands

```
npm test                 # 24 tests, all pass
npm run typecheck
npm start                # http://localhost:4310 (shows/kitchen)
npx tsx src/cli.ts check | note "..." | patch "..." --role dp | voices --engine kokoro|walla | screen | grammar
npx tsx src/cli.ts library list|search <q>|info <id>|build|port|import <bob-dir> <low-pass.html> <Odyssey.html>
```

## Code map

- `src/scene/` is the SCENE language:
  - `registry` (closed vocabulary, physics)
  - `parse` (show and episode, validator, printer)
  - `patch` (line-addressed ops, role permissions)
  - `compile` (simulation, framing solver adapted from The Bob's DIRECTOR, `protect()` keeping the lens out of walls, master-shot solver, baked frames, per-shot content hashes)
  - `geometry` (set boxes, ray tests)
- `src/qc/checks.ts`: framing, intersection, bodies in furniture, camera in geometry, occlusion, foot slide, head snaps, eyelines, 180-degree rule, continuity and timing. Every report lists what was and wasn't checked.
- `src/crew/`: roles, grammar-constrained JSON schemas, the note pipeline (`direct.ts`), the locality guard (`guard.ts`), the writers' room and screening.
- `src/claude/llm.ts`: the only Anthropic API client. It uses structured outputs, a cached system prefix, server-side fallbacks, and effort only above Haiku. `offline.ts` provides deterministic heuristics with the same interface.
- `src/voice/`: The Bob's voice method as a feature.
  - Kokoro blended voice designs (`cast x ... tts preset:anna` or `tts bf_emma:0.62+af_heart:0.38 lang en-gb speed 1`).
  - Humanising (trim, breaths, 70 Hz high-pass, loudness), and lip tracks from the audio (4 channels at 30 fps).
  - A content-addressed bank in `shows/<show>/voices/`. The compiler times dialogue from real clip durations and drives mouths from the lip tracks.
  - Engines: `kokoro`, `walla` (offline), and `command` (via `CREW_TTS_CMD`).
- `src/project.ts` (files, history, undo, notes, taste, voices), `src/index.ts` (the `Crew` facade), `src/server.ts` (HTTP API, SSE, static files), `src/mcp.ts` (MCP tools), `src/cli.ts`.
- `src/library/`:
  - `import/bob.ts`: BOB1 to GLB via headless three's GLTFExporter, plus looks and poses.
  - `import/films.ts`: OSM to GeoJSON, the Thames, parks, landmarks, the Odyssey score and shaders.
  - `port.ts`: generates the film kits.
  - `manifests.ts` (also writes the prop and set manifests), `catalog.ts`, `cli.ts`, and `node-three.ts` (Node shims).
- `web/` is the prototype animatic and UI.
- `shows/kitchen/` is the demo show: Kiran and Mum.

## Library (`library/`, about 118 MB, 122 catalog assets: 26 films/data/physics plus 86 props and 10 sets; `catalog.json` is generated)

- **Characters:**
  - `bob_{anna,baden,bob,cofer,dowie,teacher,witch}`: GLB plus `.bob1` source, 18-bone rig, materials named by slot. Verified in the browser with looks and poses applied.
  - `makehuman_{male,female}`: 163 joints. `rigs/makehuman.json` maps them.
- **Looks and poses:** `looks/the_bob.json` (14 looks and the body each wears) and `poses/the_bob.json` (21 poses).
- **Music:** `the_bob_score_{real,alias}` (mp3 with markers) and `odyssey_score` (m4a).
- **Voices:** `voices/presets.json` holds The Bob's voice designs.
- **Data:** `london_osm` (70,180 buildings: GeoJSON plus compact form) and `london_geography` (Thames, parks, 28 landmarks).
- **Effects:** `effects/odyssey_ocean/glsl/*`.
- **Physics:** `physics/` (pure JS, deterministic, no three.js): Odyssey's buoyant hull on the ocean surface (`simulateHull`, `oceanHeight`), Low Pass's flight paths (`track`, `orientFrom`: banks into turns from the path), spray and wingtip trails (`Spray`, `Trail`, `replay`). `test/physics.test.ts`. Not used by SCENE yet: a `sail` / `fly` / `drive` verb for vehicle props needs an orientation channel in the bake (baked props are `[x,y,z,holder,open]` today) and a frontend change; that is the next step if wanted.
- **Film kits:** `kits/films/{the_bob,low_pass,odyssey}.js`, generated by `crew library port` from `reference/` with explicit edits, using `kits/compat.js`. Each declares `export const EXPORTS`.
  - The Bob kit was verified in WebGL: `createTheBob({renderer, container})`, then `load()`, then `renderAt(t)`. The 485 s film renders across all sets.
  - **Low Pass and Odyssey kits pass a syntax check but have never been seen rendering.**
- **Props and sets:** see the next section.
- **Reference:** verbatim originals and pipeline scripts.

## Props and sets library (done)

The user asked: "steal the props, sets etc from the films and make a library of them, with some additional ones that are missing". It is built, wired into SCENE and tested. Still backend-only: no browse API, no library page.

**86 props** in `library/props/` (`index.js` is the registry; `meta.js` is the same data without three.js so the compiler can read it):
- `interior.js` (48): The Bob's bed, net, trunk, barred window, kanga, clock, door, poster, books, shelves, lamps, paper, elixir, mug, steam, library table, chair, plus new living room, kitchen, office and classroom pieces.
- `vehicles.js` (9): Low Pass's bus, cab, van, car, river boat, train, F-16 (afterburner and vapour), B-2, plus a new bicycle.
- `exterior.js` (21): Low Pass's tree, Union Jack, bridge lamp, person and crowd; The Bob's jacaranda and hedge; new street lamp, bench, bin, bollard, traffic light, bus stop, phone box, post box, bush, rock, flower bed.
- `structures.js` (11): Low Pass's Tower Bridge, Elizabeth Tower, Shard, London Eye, St Paul's, facade-shaded block, sky and Thames water shader; The Bob's campus block, Kilimanjaro and campus sky.
- Each entry has title, category, size (measured bounding box), placement, source (The Bob, Low Pass or new), and flags (sittable, decor, animated, openable, light). `meta.js` sizes come from measuring every builder; if you change a model, run `npx tsx src/cli.ts library measure` and paste the new size/y0/center into `meta.js` (the headless test fails when a size drifts more than 3%).

**10 sets** in `library/sets/*.scene`: boarding_room, library_corner, staffroom, veranda_corridor, classroom (The Bob); living_room, office, cafe, london_street, park (new; the street and park are `open`).

**SCENE additions**
- `include <set> [as <id>]` in show.scene (`src/scene/parse.ts`, resolved from `library/sets/`; `parseShow` takes an optional resolver). Anchor, prop and dress lines after it extend that set. A library set cannot include another.
- `dress <prop> at x z [face d] [height y | on <anchor>] [scale s]`: set dressing with no stand mark. `face` is where the prop's front points; `at` is the model's centre.
- `set <id> size w d open`: no walls; QC gives the camera 15 m of free space round the rectangle.
- `anchor ... is <x>` now accepts any prop id (and still the legacy words, whose sizes are unchanged). Unknown words are a parse error. `prop ... is <kind>` says which model draws a story prop.
- Geometry (`src/scene/geometry.ts`): `furnitureSpec()` gives size, height, placement (front, at, behind, wall, ceiling, onSurface, flat), sittable, solid and decor for any word. Boxes now carry `prop`, `ry` (model rotation), `y`, `decor`, `dress`, `scale`. `obstacles` is the boxes minus decor; compile, the camera solver and QC use it, so small dressing (mugs, rugs, posters, trees, skies) never counts as a wall.
- QC: bodies are checked against dressing too, and a new `seat` warning fires when someone sits with nothing under them.
- Baked sets carry `open`, the boxes above, and `props[].kind`. The catalog has kinds `prop` and `set` (121 assets, manifests generated by `crew library build`), and `crew library search --kind set|prop` works.
- `docs/FRONTEND_PROMPT.md` documents all of it for the frontend (placing models with `buildBox`, the importmap, hooks, decor, open sets, voice clips). The v9 frontend uses it (`web/crew/props.js`); the old `/classic/` viewer still draws grey boxes and only skips walls for `open` sets and huge decor.

**Verified** in headless tests (`test/props.test.ts`: every prop builds, matches its declared size, hooks run; sets parse, marks are clear; compile, QC, bake and catalog) and in real WebGL with throwaway harnesses (a contact sheet of all models and a render of eight whole sets; deleted afterwards). Placement conventions are exactly what the harness drew.

**Still to do**
1. Verify the Low Pass and Odyssey kits render. Use a throwaway harness outside `web/` and delete it after (the library stays backend-only).
2. SCENE hooks: library music cues (`music odyssey_score`) and a `pose` verb from the pose library. Pose names need snake_case.
3. Tests for `src/voice` and `src/library` beyond the catalog checks added here.
4. Sets could have per-instance prop options (`dress hedge ... kind bougainvillea`, `city_block` style, `tree` seed). Builders accept them (`hedge({kind})`, `city_block({style})`) but SCENE does not pass options yet.
5. ~~The animatic does not draw the models~~ Done in v9.

## Frontend (v9): done, see `docs/FRONTEND.md`

`web/` is the v9 build the user supplied, now the real frontend, with the old viewer at `/classic/`. The user asked for The Bob's encoding, passes and real-time rendering, Low Pass's depth of field, shaders and atmosphere, and the physics. What landed:

- **The Bob's pipeline** (`web/crew/render/`): real-time film look with Draft/High/Ultra, accumulation passes (lens, pixel, shutter) with a per-frame budget, auto exposure, bloom, grades, grain; the part encoder with codec fallbacks and streamed muxing.
- **Low Pass:** depth-of-field leak limiter, sky, volumetric clouds, height haze, god rays, occlusion, anamorphic streaks, lens dirt.
- **Every Deliver and Create button** has a handler (`test/e2e/stubs.mjs` enforces it). The few that can't be done in a browser say so and name the alternative.
- Tests: `npm test` (50) covers the DOM-free code; `npm run e2e` is the browser suite (Chromium, software GL is fine).

Frontend leftovers: the `Look` default is on for desktop pointers, off for touch (`CrewExt.lookDefault`); lower thirds are name cards only; "Starting from a template" builds the starter from the show's own first set and cast (no new sets, because the show bible isn't editable over the API); WebM/ProRes/FBX not writable in a browser.

## Open findings (not fixed)

- `src/server.ts` serves `/assets/` from a directory that doesn't exist; README and `rigs/makehuman.json` still mention it.
- The server's OTIO export uses `renders/<shot>_<hash>.mov` and MissingReference for dialogue clips even when `src` exists (the frontend re-points video clips at the clips it exports).
- Shot hashes ignore set dressing, so a `dress` change doesn't trip the locality guard.
- The Low Pass and Odyssey kits have never been seen rendering.
