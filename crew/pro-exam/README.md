# The director's exam for Gemini 3.1 Pro

12 cases, one prompt each, covering every job Pro does in the crew:

| Cases | Tests |
| --- | --- |
| `plan-*` | turning an ambiguous note into a concrete plan, fixing a wrong first guess, a note across two shots |
| `debug-*` | writing a take that passes after the builder failed: a continuity trap, a bad address, an unknown verb |
| `review-*` | judging takes that all pass the code checks: a purpose line that lies, the opposite change, the wrong line, breaking what must be kept, a wrong tone, and a set where every take is wrong |
| `pushback-*` | a note that would hurt the film |
| `outline-*` | turning a two-scene script into shots without losing a word of dialogue |

How to run it:
1. Open each `<case>.prompt.md`, paste everything below its first line into Gemini 3.1 Pro (thinking on high), in a fresh chat each time.
2. Save Gemini's whole reply as `<case>.reply.txt` in this folder.
3. Score: `npx tsx scripts/pro-exam.ts --answers pro-exam` (from the `crew` folder). Cases with no reply file are marked as unanswered.

Regenerate the prompts after changing the pipeline with `npx tsx scripts/pro-exam.ts --dump pro-exam`. With an API key, `npx tsx scripts/pro-exam.ts gemini` runs the whole exam live.
