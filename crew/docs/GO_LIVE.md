# Going live on Gemini

Everything is built and tested against simulated Gemini replies. What is left is plugging in your key and checking the real models answer.

## 1. Add the key (5 minutes)

1. Get a key: Google AI Studio, then "Get API key".
2. In the `crew` folder: `cp .env.example .env`, then paste the key after `GEMINI_API_KEY=`.
   You can also skip this step: start the app, open the **Crew AI** menu in the title bar, pick **Gemini**, and paste the key there. It is checked and saved to `.env` for you.
3. Run `npm run doctor`. It checks:
   - the key works;
   - each model id exists for your key (Flash-Lite, Flash, Pro, the voice model);
   - each text model answers a tiny structured request at its thinking level;
   - the voice model returns audio.
   Anything wrong comes with the exact line to change in `.env`.
4. `npm start`, open http://localhost:4310.

If Google has renamed a model, `npm run doctor` lists the ids your key can use; put the right one in `CREW_GEMINI_LITE`, `CREW_GEMINI_FLASH`, `CREW_GEMINI_PRO` or `CREW_GEMINI_TTS`.

## 2. Check it on your own material (30 minutes)

| Command | What it tells you |
| --- | --- |
| `npm run eval -- gemini` | 20 notes on the sample show: how many get a checked take on the right shot, which role, time per note |
| `npx tsx scripts/pro-exam.ts gemini` | the director's exam, live: planning, debugging, review traps, pushback, outlining |
| `npx tsx scripts/prop-exam.ts <reply> --preview out.png` | scores and renders a prop builder |

Every Gemini call is logged to `<show>/.crew/llm-log.jsonl` (task, model, outcome, retries, tokens). If something goes wrong, that file says where.

## 3. What each model does

| Model | Thinking | Jobs |
| --- | --- | --- |
| Flash-Lite | low | reads each note (which shots, which role), ranks takes, plays the test-screening audience |
| Flash | high | writes the takes, repairs what the checks reject, writes shots in the writers' room, builds props |
| Pro | high | plans notes, debugs what Flash can't fix, reviews takes before you see them, outlines scripts, lays out sets from your pictures, reviews props |
| Flash TTS | n/a | voices the dialogue, with delivery from the line (whisper, shout) and a voice per character |

How much guidance each model gets is set per skill from its measured ability (`src/llm/capability.ts`), revised from the exam results. Pin any skill in `.env` with `CREW_GRIP_<SKILL>=free|guided|strict`.

## 4. What is new for you in the app

- **Notes** on Review run the Gemini crew. Expect a minute or two per note on high thinking; the crew log shows each step.
- **New episode from a script** (Home) runs the writers' room. With a **3D set** and inspiration pictures, Pro also proposes a set layout from the pictures; nothing changes until you press **Use this layout**.
- **Props** the library doesn't have can be made from a description (`npm run crew -- prop "<id>" "<description>"`, the `crew_make_prop` MCP tool, or `POST /api/props`). Flash builds it, code checks size, ground contact, centring and inside-out surfaces, and Pro reviews it. New props join the backend library by id.
- **Voices**: `npm run crew -- voices` (or Render voices) uses Gemini's voices when `CREW_TTS=gemini`.

## 5. Not connected yet

- **Supabase**: storage goes through one interface (`src/storage/`), with the filesystem as the only adapter. `docs/STORAGE.md` has the steps to add Supabase. `CREW_STORAGE=supabase` stops with a clear message until then.
- **Gestures** (new animation verbs written by the models) and **music generation** are planned in `docs/ASSETS.md`, not built.

## 6. Things only the live API can confirm

- The exact model ids (the doctor checks them).
- The voice model's request and audio format (built to Google's documented shape; the doctor's voice check proves it).
- Rate limits on your account: the client waits and retries on 429s and says plainly when a daily quota runs out.
