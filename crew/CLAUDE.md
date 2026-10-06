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
- `src/claude/llm.ts` is the only place that talks to the Anthropic API. `offline.ts` mirrors it without a network.
- `library/` is the backend-only asset library (characters, props, sets, kits, music, voices): never add a user-facing page or browse API for it. `library/props/` is the prop registry (`meta.js` data, `index.js` builders); `library/sets/*.scene` are the ready-made sets.
- `web/` is the browser animatic and UI. The frontend brief is `docs/FRONTEND_PROMPT.md`.
