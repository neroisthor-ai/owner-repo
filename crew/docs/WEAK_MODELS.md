# The harness: making weaker models useful

Goal: run the crew on cheap models (Gemini Flash Lite, Flash, and Pro for the rare hard call) and get takes close to what Claude gives, by moving work out of the model and into code.

The rule behind every piece below: **the model makes small choices, the code does everything else.** A weak model is bad at writing exact syntax, holding a big context, and checking its own work. It is decent at picking from a short menu, filling one slot, and judging between two options. So the harness turns every job into menus and slots, checks every answer in code, and tells the model exactly what was wrong when it misses.

This sits beside the provider plan in `MODEL_PROVIDERS.md` (which also covers running Claude through Claude Code). That doc is about talking to other APIs; this one is about what we ask them.

## What already helps

Most of the hard checking exists today and stays as is:

- `parsePatch` / `toOps`: syntax.
- Permissions: a role can only write its own line kinds.
- The locality guard: no change leaks into shots the note didn't name.
- QC in code: collisions, framing, timing, continuity.
- The offline crew (`src/claude/offline.ts`): rule-based takes for the common notes. In the harness these become **candidate generators**, not a fallback.

Every one of those already produces a reason string when it rejects something. The harness turns those reasons into feedback a small model can act on.

## The six parts

### 1. Steps, not prompts

Every model call becomes a **Step**: one narrow question with a typed answer.

```ts
interface Step<In, Out> {
  id: string;                         // "route.role", "build.pick-line", "build.fill-slots", ...
  job: "route" | "build" | "direct";  // which model tier runs it
  context(input: In): Ctx;            // only what this step needs
  menu(input: In): Schema;            // enums built from this shot, this set, this role
  examples(input: In): Example[];     // 0-3 worked examples, chosen for this note
  validate(out: Out, input: In): Problem[];  // code checks, each with a fix hint
  assemble?(out: Out, input: In): unknown;   // code turns choices into a patch
  fallback?(input: In): Out | null;   // what code does if every model fails
}
```

The runner (part 4) owns retries, voting, escalation and logging, so each step is small and testable on its own.

### 2. Generate in code, choose with the model

For most notes the right edit is one of a handful of obvious moves. Code generates those moves; the model picks.

- **Candidate sources:**
  - The offline heuristics, already written per role.
  - **Parameter sweeps.** "Too long" on a 2.5s beat gives ~1.5, ~1.8 and ~2.0. "Closer" gives the next one or two sizes up. "Slower" gives the next speeds down.
  - **Templates** for the common note types: trim head/tail, hold, swap a reaction verb, add or remove a sound, move an anchor.
- **Check before the model sees anything.** Every candidate goes through the guard and QC first. The model only ever sees candidates that are legal.
- **The model's job** is to rank the verified candidates against the note. That is a multiple-choice question with a tiny schema: `{ pick: 0..n, why }`. Flash Lite can do this.
- **Coverage:** this covers the bulk of real notes. When no candidate fits ("none of these"), the step falls through to slot filling (part 3).

### 3. Slot filling for everything else

When the edit is not one of the obvious moves, the model still never writes SCENE text. It answers three small questions in turn.

1. **Which line.** A numbered list of the lines in the target shot that this role may change, plus "add a new line after N". The answer is the line number.
2. **What kind of change.** Pick one of: change timing, change the action, change who or where, insert a new beat, delete. Only kinds this role may do are offered.
3. **The values.** One slot at a time. Each slot is an enum built for this exact spot:
   - **Verbs:** only the verbs this role owns.
   - **Characters:** only the characters present in the shot.
   - **Anchors and props:** only the ones in this set.
   - **Numbers:** a range around the current value.

Code assembles the patch line from the answers, so syntax errors are impossible by construction. Small enums also keep us under the schema size limits that smaller models hit with the full grammar.

### 4. The runner: repair, vote, escalate, fall back

One runner executes every step.

1. **Call** at the step's starting tier, at low temperature.
2. **Check** the answer: parse it, validate it, assemble it, run the guard and QC.
3. **Repair.** On failure, send one short correction and ask again. Only the latest problem goes back, not the history. The correction is specific: "'moonwalk' is not a verb. Pick one of: walk, run, sit, stand." Or: "1D has lines 1D.1 to 1D.6. 1D.9 does not exist." Hints come from a table in `feedback.ts` keyed by the guard's and parser's error codes, so new error types get a hint once and every model benefits.
4. **Vote** on cheap choice steps: sample 3 answers and take the majority among the ones that pass the checks. Pick-type steps only; writing steps don't vote.
5. **Escalate** the step: Lite, then Flash, then Pro. Pro stays rare, as with Opus today.
6. **Fall back** to the step's code answer (the offline heuristic) when everything failed, and say so in the crew log. A note never comes back empty for a note type the offline crew knows.

Every attempt is logged to `.crew/llm-log.jsonl`: step, model, tokens, ms, outcome, and the problem if any. That log is the raw material for parts 5 and 6.

### 5. Worked examples, kept honest

Small models copy patterns far better than they follow rules, so every step gets two or three examples of note to answer.

- **Where they live:** `src/crew/examples/*.json`, tagged by role and note type.
- **They can't rot:** a unit test runs every example against the sample shows through the real parser, guard and QC. When the grammar changes, a broken example fails CI.
- **Retrieval:** pick examples by keyword overlap with the note and by role. No embeddings needed to start.
- **Growth:** when the log shows a model repeatedly failing a kind of note and a human accepts a take for it, that pair becomes a candidate example.

### 6. Profiles: same pipeline, different grip

Each model gets a profile that sets how much the harness holds its hand.

| Setting | Flash Lite | Flash | Pro / Claude |
| --- | --- | --- | --- |
| Build strategy | choose + slots only | choose, then slots, then short free patch with repair | free patch (today's path) |
| Examples per step | 3 | 2 | 0-1 |
| Context | target shot only | target shot + neighbours | episode listing |
| Votes on choice steps | 3 | 1 | 1 |
| Repairs per step | 2 | 2 | 1 |
| Max enum size per slot | ~60 | ~150 | whole grammar |
| Structured output | native schema, else JSON + validate | native schema | native schema |

- **Default jobs:** route on Lite, build on Flash, direct on Pro.
- **Adaptive:** the profile is data, not code. A step whose success rate on a model falls under a threshold in the log is moved up one tier for that step automatically. A tier that does consistently well is tried one tier down.
- **Claude unchanged:** Claude stays on the current path with its own profile.

## The writers' room for weak models

Writing a whole episode in one go is beyond a small model. Split it into steps:

1. **Script to scenes.** Code splits on scene headings where the script has them; the model fills the gaps.
2. **Scene to a shot outline.** One shot per row: type, subjects, what happens. Picked from enums, the same way as part 3.
3. **Shot by shot body lines.** Slot filling with the shot's cast and the set's anchors. Dialogue text is the one free-text field, and it goes into a quoted slot.
4. **Assemble and repair locally.** Code assembles the episode and the validator repairs shot by shot, never the whole episode.

Pro reviews the outline once (one call). That is the "director sets the plan" step.

## Measuring it

Nothing above is worth much without numbers, so the eval comes early, not last.

- **Golden notes:** `test/fixtures/notes.json`, about 60 notes across all six roles on the sample shows. Each has the shot, the expected kind of change, and how to recognise a good result, such as "the beat at 1D.2 is shorter and nothing else in 1D changed".
- **Offline in CI:** recorded model answers per step, replayed, so the harness is regression-tested for free.
- **Live:** `npm run eval -- --profile gemini` runs the set against real models and prints, per step and per model:
  - valid answer rate, check pass rate, repairs used;
  - note resolution rate;
  - cost, and time per note.
- **Gate:** a model only takes a job if its resolution rate matches or beats the current holder's on the golden set.

## Build order

Most value first; each phase ships on its own.

| Phase | What | Files |
| --- | --- | --- |
| 1 | Provider layer and Gemini adapter (with free-tier rate limiting), profiles in config | `src/llm/providers/*`, `src/llm/profiles.ts` |
| 2 | Step + runner: repair with hints, voting, escalation, fallback, logging | `src/harness/step.ts`, `runner.ts`, `feedback.ts` |
| 3 | Golden notes and the eval script (recorded and live) | `test/fixtures/notes.json`, `scripts/eval.mjs` |
| 4 | Generate-and-choose build: candidates from offline heuristics, sweeps and templates, the verified menu, the pick step | `src/harness/candidates.ts`, `steps/build-choose.ts` |
| 5 | Slot filling: pick line, pick kind, fill slots, assemble | `src/harness/menus.ts`, `steps/build-slots.ts` |
| 6 | Examples library with its test, and retrieval | `src/crew/examples/*`, `src/harness/examples.ts` |
| 7 | Writers' room in steps | `src/harness/steps/write-*.ts` |
| 8 | Adaptive tiering from the log | `src/harness/tuning.ts` |

`direct.ts` chooses the path from the profile: today's free-patch path for Claude and Pro, the harness for Flash and Lite. Both produce the same takes, so nothing downstream changes: the UI, accept, undo, history and QC work as they do now.

## Open questions

- **Model names and IDs.** I have not verified the Gemini model names, their IDs, or their schema limits. The adapter lists models from the API at setup and degrades on its own if the schema is too complex. Expect some trial and error when we first point it at the real API.
- **Taste.** Choice-based takes tend to be safe. Pro (or Claude, if you ever add a key) is where bolder ideas come from. The `idea` field can stay a Pro-only extra.
- **Free tiers.** Free tiers may train on prompts, and every prompt carries show text. The UI should say this beside any free profile.
