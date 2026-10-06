# Plan: the crew on Gemini

Three models, each with its own jobs. Usage is not rationed, so each job goes to the model that does it best, and speed is the only reason to skip a call.

| Model | Thinking | Character | Jobs |
| --- | --- | --- | --- |
| **3.5 Flash-Lite** (`gemini-3.5-flash-lite`) | minimal, low for ranking | fastest, cheap to call many times | Router, ranker, voter, checker's explainer, test audience |
| **3.8 Flash** (`gemini-3.8-flash`) | medium | the workhorse | Builder for every craft role, repairs, writers' room shots and dialogue |
| **3.1 Pro** (`gemini-3.1-pro-preview`) | medium, high for scripts | strongest judgement | Director: plans, reviews, debugs, writes outlines, talks to you |

IDs live in config and are checked against the live model list at startup (Pro is a preview and may be repointed).

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
| **Writers' room** (script to episode) | Pro splits the script into scenes and writes the shot outline (high thinking). Flash writes each shot's lines from the outline, one shot at a time. Code assembles and validates; Flash repairs failing shots; Pro reviews the whole episode once. |
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
| 1 | Gemini adapter: `generateContent`, `thinking_level`, `response_json_schema`, schema-too-complex fallback, retries on 429/5xx, live model list check, key setup in the Crew AI menu |
| 2 | Step runner (repair with hints, votes, escalation, offline fallback, `.crew/llm-log.jsonl`) and the per-shot schemas |
| 3 | The note pipeline above, wired into `direct.ts` behind a `gemini` profile; Claude and offline stay as they are |
| 4 | Golden notes eval (about 60 notes) with recorded answers in CI and a live run per model |
| 5 | Writers' room and screening on the new roles |
| 6 | Tuning from the eval: thinking levels, votes, which steps Pro takes |

Phase 1 needs a Gemini API key to test live; everything else is tested with recorded answers.
