# Crew

**The AI film crew that takes direction.** You write and direct; Claude's crew builds. Every note changes exactly what you asked for and nothing else.

```bash
npm install
npm start            # http://localhost:4310  (offline crew without a key; Claude with ANTHROPIC_API_KEY)
npm test
```

## How it works

```
note ──► router (Haiku) ──► role proposes wide (Haiku ×2, grammar-constrained JSON)
     ──► code filter: permissions → grammar → locality guard → QC
     ──► refine (Sonnet) ──► filter ──► director picks + explains (Opus) ──► 2-3 takes
```

- **SCENE.** A terse, closed-vocabulary film language. Every line has an address, and patches are a few tokens (`1D.2 ~2.5 -> ~1.5`). Run `crew grammar` for the reference.
- **Grammar-constrained output.** Each role's JSON schema is generated from the registry and the show bible, and holds only the line kinds that role owns. Claude can't emit an unknown word or another role's line.
- **Locality guard.** Every shot is content-hashed from its rendered frames. A patch that changes a shot you didn't name is rejected with the reason.
- **Escalation on failure only.** A role climbs Haiku → Sonnet → Opus only when every candidate failed the checks, and the next tier sees why they failed.
- **Real-world compile.** The compile uses walking speed, speaking pace from the cast list, and real lenses on a 36x24 sensor. The framing solver handles headroom, look room, the 180° line, and keeping the lens out of walls with focal-length compensation. Characters animate on twos; cameras on ones.
- **QC in code.** Framing, intersection, bodies in furniture, camera in geometry, occluded faces, foot slide, head snaps, eyelines, 180°, continuity, reach, dialogue timing and clipping, and ASL. Every report lists what was **not** checked.
- **Persistence.** Plain files: `show.scene` and `epNN.scene`. `.crew/` holds history, snapshots for undo, notes and taste memory. The north star is the **note resolution rate**.

## Integrating Claude

| Way | Use |
|---|---|
| Built-in crew | Set `ANTHROPIC_API_KEY` (or `ant auth login`). Models: `CREW_MODEL_OPUS/SONNET/HAIKU`. `CREW_PIPELINE=fast` skips Haiku and Opus. `CREW_FALLBACKS=0` disables server-side fallbacks. |
| Claude Code / Desktop | `.mcp.json` registers the `crew` MCP server: `crew_overview`, `crew_patch`, `crew_note`, `crew_accept`, `crew_check`, `crew_shot_state`, `crew_screen`, `crew_export_otio`, and more. `CLAUDE.md` teaches the workflow. |
| Library | `import { Crew } from "./src/index.ts"`. Then `Crew.open(dir).note("1D too long")`, `.accept()` and `.patch()`. Pass any object with a `call()` method as `llm` to plug in another client. |
| CLI | `crew note "1A, kiran clips mum" --accept`, `crew patch "1D.2 ~2.5 -> ~1.4" --role animator`, `crew check`, `crew write script.txt`, `crew screen`, `crew export otio`. |

Prompt caching: the crew rules, SCENE grammar and show bible form a stable system prefix with a cache breakpoint, shared by every agent call.

## Assets

The asset library (`library/`, backend-only) holds characters, 86 props, 10 ready-made sets, film kits, scores and voice designs from earlier projects (The Bob, Low Pass, Odyssey) plus new pieces. Use a set with `include cafe` in `show.scene`, dress it with `dress <prop> at x z`, and find things with `crew library search <q> [--kind prop|set]`.

`assets/characters/human_{male,female}.glb` are MakeHuman-style rigs with 163 joints. `rig.json` maps Crew's pose channels to their bones. Cast members pick one with `cast <id> ... model male|female`.

## Status

**Built and tested:**
- SCENE language, patches and permissions
- Locality guard and QC
- Offline crew and the full Claude pipeline (request shapes tested against a mock client)
- Writers' room and screening
- MCP server, CLI and HTTP API
- Browser frontend (v9): the animatic with The Bob's film look (real time and accumulation passes), Low Pass's atmosphere, MP4 export, and every export a crew hands to editorial, 3D apps and a phone shoot (`docs/FRONTEND.md`)
- Props, sets and a physics library (`library/props`, `library/sets`, `library/physics`)

**Not yet verified live:**
- Real Claude calls: no API key was available while building.
- The film renderer on a real GPU: it is tested in Chromium on software GL (`npm run e2e`); speeds on hardware are untested.

**Not built (roadmap weeks 2+):**
- Phone capture (the shoot pack lines the shot up over the camera; nothing is captured back)
- Blender finals
- Dubbing
- Re-shot formats
