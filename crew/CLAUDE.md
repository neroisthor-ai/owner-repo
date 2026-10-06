# Crew

An AI film crew that takes direction. Films are SCENE source (`shows/<show>/show.scene` and `epNN.scene`) compiled into a 3D animatic.

## Working on a show (as the crew)
- Use the `crew` MCP tools (`.mcp.json`): `crew_overview` first, then `crew_patch` with the narrowest `role` that owns the lines. Use `dry_run` to compare 2-3 takes before applying one.
- Never rewrite whole episodes for a note. Patch addresses (`1D.2 ~2.5 -> ~1.5`). The locality guard rejects changes that leak into other shots, and its reasons say how to fix them (often `actor@anchor` to pin continuity).
- Line ownership: writer = dialogue; blocking = enter/walk/sit/take…; dp = shot headers + light; animator = faces, looks, gestures; editor = trim/hold/drop shot; sound = sfx/music/ambience/silence.
- `crew_check` lists what QC checked and what it didn't. Say both when reporting.
- `npx tsx src/cli.ts grammar` prints the full SCENE reference.
- Sets come from the library: `include cafe` in `show.scene`, then extend with `anchor`/`prop`/`dress` lines. `crew_library` (kind `set` or `prop`) lists what exists. People write the show bible; the crew only edits episodes.

## Working on the code
- TypeScript run by tsx, no build. `npm run typecheck`, `npm test`, `npm start` (http://localhost:4310).
- `src/scene/` holds the language: registry, parse, patch, compile (simulation + framing solver), and geometry.
- `src/crew/` holds roles, schemas (grammar-constrained outputs), the note pipeline (`direct.ts`), the guard, writers' room and screening.
- `src/claude/llm.ts` is the only place that talks to the Anthropic API, `src/llm/gemini.ts` the only place that talks to Gemini. `offline.ts` mirrors them without a network.
- Gemini runs the guided pipeline (`src/crew/guided.ts`, see `docs/GEMINI_CREW.md`): assume those models get formats wrong, so every answer is cleaned, re-checked in code, explained back on failure, and the offline crew is the last resort. Measure changes with `npm run eval -- gemini`.
- `npm run doctor` checks the Gemini setup (key, model ids, voices); `docs/GO_LIVE.md` is the go-live guide. New props are made by `src/assets/props.ts` (sandboxed builder code, checks, Pro review) and land in `library/props/generated/`; sets from pictures by `src/assets/set-layout.ts` (a proposal the director accepts). Storage goes through `src/storage/` (filesystem only; Supabase not connected, see `docs/STORAGE.md`).
- `library/` is the backend-only asset library (characters, props, sets, kits, music, voices): never add a user-facing page or browse API for it. `library/props/` is the prop registry (`meta.js` data, `index.js` builders); `library/sets/*.scene` are the ready-made sets.
- `web/` is the browser frontend (the v9 bundle plus readable modules in `web/crew/`). Read `docs/FRONTEND.md` first: change features in `web/crew/`, keep `web/app.js` patches small and marked `// CREW-EXT:`. The brief is `docs/FRONTEND_PROMPT.md`.
- Each feature has one home page (see "One home for every feature" in `docs/FRONTEND.md`): before adding a control, check it is not already somewhere else.
- `scripts/build-static.mjs` builds a server-less copy of the frontend (the current project baked into `state.json`) for hosting a preview.
- `npm run e2e` runs the browser tests (Chromium; set `PW_NODE` and `CHROMIUM`).
