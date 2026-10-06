# Handoff prompt

Paste everything below the line into a new Claude (or other coding agent) session, with this folder attached or the repo checked out.

---

You are picking up **Crew**, an AI film crew that takes direction. Films are written in a small text language (SCENE): `shows/<show>/show.scene` is the show bible (sets, characters), `epNN.scene` the episodes. They compile into a 3D animatic in the browser. The director gives notes ("1D shorter, Kiran looks nervous") and an AI crew edits the episode with narrow, checked patches.

**Repo:** `neroisthor-ai/owner-repo`, branch `claude/crew-props-sets-library-vfdnbk`, project in `crew/`. Read `crew/CLAUDE.md` first, then `docs/GO_LIVE.md`, `docs/GEMINI_CREW.md`, `docs/FRONTEND.md`.

**Run it:** Node 22+. In `crew/`: `npm install`, then `npm start` and open http://localhost:4310. `npm run doctor` checks the Gemini setup. `npm test` (151 tests), `npm run typecheck`. `.env` holds the settings and the Gemini key (git-ignored, included in this bundle).

## How the owner works
- Direct and impatient. Do what he asks without arguing; push back only when it genuinely helps him decide. Never patronise.
- No em dashes anywhere. Write like a person, not an AI.
- Commit and push to the branch above. Never open a pull request unless asked.
- The asset library (`library/`) stays backend-only: no user-facing library page or browse API.
- The Bob's voice clips stay deleted.
- Each feature has one home in the UI; never repeat a control across tabs.
- Supabase is NOT connected yet (seam in `src/storage/`, steps in `docs/STORAGE.md`). Don't connect it until asked.
- Subagents: use cheaper models (Sonnet/Haiku) for grunt work.

## The AI crew
Two providers behind one `LLM` interface (`src/claude/llm.ts`): Claude (`src/claude/llm.ts`) and Gemini (`src/llm/gemini.ts` client, `src/llm/gemini-llm.ts` crew). Offline rules (`src/claude/offline.ts`) are the fallback.

Tiers are internal job names: `haiku` reads and ranks, `sonnet` builds, `opus` directs (plans, debugs, reviews). On Gemini:
- **haiku -> Flash-Lite** (thinking low), ladder `gemini-3.5-flash-lite > gemini-3.1-flash-lite`.
- **sonnet -> Flash** (thinking high), ladder `gemini-3.8-flash > 3.7 > 3.6 > 3.5`.
- **opus -> Pro** (`gemini-3.1-pro-preview`), or with `CREW_PRO_MODE=flash` a **Flash group**: `CREW_FLASH_GROUP` Flash calls side by side (high thinking, 65,536 output tokens), then a final Flash pass that checks them against each other and writes the answer. Agreeing answers skip the final pass.
- **Ladders:** free quota is per model. Out of quota, rate limited, overloaded (503) or missing steps down to the next model; the spent one rests until Google's reset time. Logged to `shows/<show>/.crew/llm-log.jsonl`.
- Guidance per skill comes from measured ability (`src/llm/capability.ts`: free / guided / strict). The Gemini pipeline is `src/crew/guided.ts` (read, plan, build, clean, repair with explained failures, debug, rank, review, offline fallback).

## Current state of the keys (important)
- The key in `.env` is a **free-tier** key. Free tier facts measured live: **Pro limit 0** (not available at all), **Flash 20 requests/day per model**, Flash-Lite answers fine. 3.8 Flash was also often overloaded (503).
- That is why `.env` has `CREW_PRO_MODE=flash` and `CREW_FLASH_GROUP=2`.
- The owner has two other projects with prepaid billing but **zero credit**. Topping one up unlocks Pro and paid limits; then set that key and `CREW_PRO_MODE=auto`.
- Do NOT rotate several free accounts' keys to stack free quota: it breaks Google's terms and risks banning all linked accounts. This was discussed and declined. Spreading load across separately billed, funded projects is fine.
- Gemini app (consumer Pro plan) cannot be scripted as a backend (terms). The legitimate route for a Pro subscription is Antigravity CLI headless (`agy -p`), but reports say its quota runs out after a few prompts. Not built; the owner may ask for an `agy` bridge as a crew option.

## Last live test (free key, ladder on)
Note on shot 1D: "Kiran should look nervous before he speaks, glancing at Mum, and hold the shot a beat longer."
- Flash-Lite routed it in 0.8s (animator + editor on 1D).
- Planning (Flash group of 2): 3.8 Flash rate limited / 503, 3.7 rate limited / 503, **3.6 Flash answered**; final pass 3.8 out of daily quota, stepped to 3.6, done. The ladder works as designed.
- The build, rank and review steps were still running when this was written. Check `shows/kitchen/.crew/llm-log.jsonl` and the Review page for the takes.

## Built and working
Timeline editing (own sounds/images, green screen), 3D vs 2D sets with inspiration pictures, Gemini set layouts from pictures (a proposal the director accepts), props made from a description (sandboxed builder code, checks incl. inside-out surfaces, review; `npm run crew -- prop <id> "<desc>"`), Gemini voices (`src/voice/gemini-tts.ts`), the doctor, eval (`npm run eval -- gemini`), Pro exam tooling (`scripts/pro-exam.ts`, `crew/pro-exam/`), storage seam, animated home title and background.

## Not built / open
- Gestures (new animation verbs written by models) and music generation (planned in `docs/ASSETS.md`).
- Rendered-image review of props (today it uses measurements).
- Antigravity CLI bridge (optional, owner to decide).
- Pro exam Q10 to Q12 not scored.
- Supabase adapter (only when asked).
- Hosting: the app needs its server; the static preview (`scripts/build-static.mjs`) has no AI. The owner may want a free host (Render/Railway) set up.

## Suggested first step
Run `npm run doctor`, then put one note through the Review page and read `.crew/llm-log.jsonl` to see which models did what. Ask the owner what he wants next.
