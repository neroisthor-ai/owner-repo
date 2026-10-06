# The crew on Gemini

**Status: built.** Pick **Gemini** in the Crew AI menu (or set `GEMINI_API_KEY` in `.env`, or `--llm gemini`). It has not yet run against the live API from this repo; the first live run should be `npm run eval -- gemini`.

| Piece | File |
| --- | --- |
| REST client: retries, rate limits, thinking level, schema fallback, cut-off and blocked replies | `src/llm/gemini.ts` |
| Tolerant JSON: fences, prose, trailing commas, smart quotes, near-miss enums | `src/llm/json.ts`, `src/llm/schema-lower.ts` |
| Model per job, thinking per job, format repair, call log (`.crew/llm-log.jsonl`) | `src/llm/gemini-llm.ts` |
| The note pipeline below | `src/crew/guided.ts` |
| Role guide, the editable lines, worked examples built from the real shots | `src/crew/patchguide.ts` |
| Failure reasons turned into plain fixes ("moonwalk is not a verb; closest: walk") | `src/crew/feedback.ts` |
| Writers' room in steps | `src/crew/guided-writers.ts` |
| Golden notes and the eval | `test/fixtures/notes.json`, `scripts/eval.ts` (`npm run eval -- offline|gemini|claude`) |
| Tests with a deliberately sloppy fake model | `test/guided.test.ts`, `test/gemini.test.ts`, `test/patchguide.test.ts` |

Model ids are `CREW_GEMINI_LITE`, `CREW_GEMINI_FLASH`, `CREW_GEMINI_PRO` in `.env` (defaults below). Key setup lists the models the key can use and names any that are missing.

Not built yet from the plan: Pro summarising the test screening, Pro rewriting the taste memory, Lite rewording failures for the crew log (code does it today), and adaptive tuning from the log.

## The plan

Three models, each with its own jobs. Usage is not rationed, so each job goes to the model that does it best. Flash and Pro always think at the maximum level (high); Flash-Lite thinks at low. High thinking is slower, so expect a note to take longer than on Claude.

| Model | Thinking | Character | Jobs |
| --- | --- | --- | --- |
| **3.5 Flash-Lite** (`gemini-3.5-flash-lite`) | low | fastest, cheap to call many times | Router, ranker, voter, checker's explainer, test audience |
| **3.8 Flash** (`gemini-3.8-flash`) | high (max) | the workhorse | Builder for every craft role, repairs, writers' room shots and dialogue |
| **3.1 Pro** (`gemini-3.1-pro-preview`) | high (max) | strongest judgement | Director: plans, reviews, debugs, writes outlines, talks to you |

IDs live in config and are checked against the live model list at startup (Pro is a preview and may be repointed).

**No Pro on your key? The Flash group stands in.** The free API tier has no Pro (Google reports `limit: 0`; a Gemini app subscription doesn't change that). With `CREW_PRO_MODE=flash`, every Pro job above goes to a group of `CREW_FLASH_GROUP` (default 3) Flash calls on high thinking with the largest output room (65,536 tokens), run side by side. If they all agree, that answer is used as it is. If they disagree, one more Flash call sees the task and every answer, works out which is right, fixes what they all missed and writes the final answer in the same format. If that pass fails, the first good answer is used. `CREW_PRO_MODE=auto` (the default) tries Pro and switches to the group for the rest of the run the first time Google says Pro is out of quota. The grips follow the model doing the work, so Pro's jobs get Flash's guidance while the group stands in. Each Pro job then costs up to four Flash requests, which counts against the free tier's Flash limits.

**Ladders.** Google sets free quota per model, so each tier has a ladder of models, best first: Flash is `gemini-3.8-flash > 3.7 > 3.6 > 3.5` (`CREW_GEMINI_FLASH_LADDER`), Flash-Lite is `3.5 > 3.1` (`CREW_GEMINI_LITE_LADDER`). When a model runs out of quota, is rate limited, overloaded (503) or missing, the call steps down to the next, and that model is skipped until Google says its quota resets (or a minute or two for overload). The grips follow whichever model is on top, and the older Flash models get a notch more guidance (`src/llm/capability.ts`). Every step down is written to the crew log.

## A note, step by step

1. **Read the note (Lite).** Find the shots, timestamps and the one or two roles that own the fix. Code resolves shot ids and timestamps first; Lite fills in the rest. Three votes; majority wins.
2. **Plan (Pro).** Every note that is not a plain parameter tweak gets a plan: the goal in one sentence, which roles act on which shots, what must not change, and what a good result looks like. Plain tweaks ("1D shorter", "warmer") skip this for speed.
3. **Generate candidates (code).** The offline rules, number sweeps and templates make every obvious move. All go through the guard and QC.
4. **Build (Flash).** For each role, Flash writes 2-3 takes from the plan, using native structured output with a per-shot schema (small menus, so we stay under Gemini's schema size limit). Takes go through the guard and QC.
5. **Repair (Flash).** A failed take comes back with the exact reason and a fix hint ("'moonwalk' is not a verb; pick walk, run or sit"). Two repair rounds.
6. **Debug (Pro).** If Flash still has nothing that passes, Pro sees the plan, the failures and the shot, and writes the fix.
7. **Rank (Lite).** Code candidates and Flash takes that passed are ranked against the note by Lite: three votes, top three kept.
8. **Review and explain (Pro).** Pro checks the top takes against the plan, orders them, writes the short message to you, keeps or sharpens pushback, and adds one idea. If no take matches the plan, Pro sends one round back to Flash with notes.

Nothing reaches you that has not passed the code checks. If every model fails, the offline answer is used and the log says so.

## Other jobs

| Job | Who |
| --- | --- |
| **Writers' room** (script to episode) | Pro splits the script into scenes and writes the shot outline. Flash writes each shot's lines from the outline, one shot at a time. Code assembles and validates; Flash repairs failing shots; Pro reviews the whole episode once. |
| **Test screening** | Lite plays each synthetic viewer (many in parallel); Pro summarises what the audience missed. |
| **Captions, chapters, shot list wording** | Lite. |
| **QC "Ask the crew to fix this"** | Goes in as a note: Pro plans it with the QC issue as the goal. |
| **Taste memory** | Pro rewrites the director's taste summary after every few accepted or rejected takes. Flash reads it when building. |
| **Explaining a failure to you** | Lite turns raw check reasons into plain sentences in the crew log. |

## Hand-holding per model

| | Lite | Flash | Pro |
| --- | --- | --- | --- |
| Context | the target shot | target shot + neighbours + plan | whole episode listing |
| Output | multiple choice, tiny schemas | per-shot schema; JSON without schema as fallback | free text or light schema |
| Worked examples | 3 | 2 | 0-1 |
| Votes | 3 | 1 | 1 |
| Repairs | 1 | 2 | 1 |

## Building it

| Phase | What |
| --- | --- |
| 1 | Gemini adapter: `generateContent`, `thinking_level` (Lite low, Flash and Pro high; set explicitly on every call), `response_json_schema`, schema-too-complex fallback, retries on 429/5xx, live model list check, key setup in the Crew AI menu |
| 2 | Step runner (repair with hints, votes, escalation, offline fallback, `.crew/llm-log.jsonl`) and the per-shot schemas |
| 3 | The note pipeline above, wired into `direct.ts` behind a `gemini` profile; Claude and offline stay as they are |
| 4 | Golden notes eval (about 60 notes) with recorded answers in CI and a live run per model |
| 5 | Writers' room and screening on the new roles |
| 6 | Tuning from the eval: votes, examples, which steps Pro takes (thinking levels stay fixed) |

Phase 1 needs a Gemini API key to test live; everything else is tested with recorded answers.
