# Plan: running the crew on other models

Status: plan only. Today the crew runs on Claude (Haiku routes, Sonnet builds, Opus directs) and offline rules. This is what it takes to add other providers, for example Google's Flash and Pro models and whatever follows them, without rewriting the crew.

I have not verified the exact model names or IDs for "Flash 3.8", "3.1 Pro" or "4 Pro". Nothing below depends on them: model IDs live in config, and setup should list what the provider actually offers.

## Where Claude is baked in today

| Coupling | Where |
| --- | --- |
| Tier names are Claude names (`haiku` / `sonnet` / `opus`) | `src/crew/roles.ts`, events, UI menu, tests |
| Model IDs and prices | `MODELS` and `PRICES` in `src/claude/llm.ts` |
| Request shape: `output_config.format` JSON schema, `effort`, `cache_control`, server-side fallback beta | `ClaudeLLM.call` |
| Error handling uses Anthropic's exception classes | `ClaudeLLM.call` |
| Key setup validates against Anthropic | `src/claude/setup.ts`, `POST /api/key` |
| "Crew AI" mode is `claude` or `offline` | `LLM.mode`, `pickLLM`, `/api/mode`, the menu |

The crew itself (`direct.ts`, guard, schemas) only needs `LLM.call()`. That is the seam to build on.

## Target shape

1. **Jobs, not model names.** Tiers become three jobs: `route` (cheap and quick), `build` (the workhorse), `direct` (rare, strongest). Display names stay friendly. Opus-light still holds: `direct` is called only to plan ambiguous notes, debug, and pick between close takes.
2. **Provider adapters.** One interface: `Provider { id, caps, call(request) -> normalized result }`. Adapters: `anthropic` (exists, moved), `gemini`, `openai-compatible` (covers Groq, OpenRouter, Ollama, LM Studio, vLLM). Each declares `caps`: JSON schema support (`native` | `prompt-only`), reasoning control, caching style, max output, parallel call limit.
3. **A routing config.** `crew.models.json` (or env), one entry per job: `{ provider, model, effort, fallbacks: [...] }`, plus named profiles such as `claude`, `gemini`, `mixed`, `local`. A new model is a config change when its adapter already conforms. A `RoutedLLM` implements `LLM` and picks the entry per call.
4. **Structured output that survives weaker providers.**
   - Native schema where the provider supports it. Some providers accept only a subset of JSON Schema, so add a per-provider schema "lowering" step. Our schemas use only objects, arrays, enums, strings, integers and nullable fields, which lower cleanly.
   - Where native schema is missing, put the schema in the prompt, parse, then repair with one retry that quotes the parse error. The existing code filter (`toOps`, permissions, locality guard, QC) already rejects bad output, so weak models fail safely, they just fail more.
5. **Reasoning and effort.** `effort: medium` maps to each provider's own knob (a thinking level or budget). Haiku-like models get none.
6. **Caching.** Keep the stable prefix first (already true). Anthropic uses explicit breakpoints; others cache implicitly or through a cached-content call. The adapter owns this.
7. **Cost and limits.** Move prices to config per model, including `free` entries at $0. Free tiers have requests-per-minute and per-day caps, so add a per-provider limiter: queue, concurrency cap, backoff on 429, and a crew log line like "rate limited, retrying in 12s". Unknown model: cost shows as unknown, not wrong.
8. **Fallback across providers.** Per job, an ordered list. Triggers: auth, rate limit past the retry budget, timeout, refusal, invalid JSON after repair. The note record keeps which model actually answered.
9. **Keys and setup.** `.env` holds one key per provider (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, base URL and key for compatible servers). `POST /api/key` takes `{ provider, key }` and validates with a one-token call on that provider. Local servers need no key, only a reachable URL.
10. **UI.** The Crew AI menu becomes: pick a profile, see which model does each job, add a key per provider, and one line of status per provider (ready, key missing, rate limited). Nothing about thoroughness returns.

## Phases

| Phase | Work | Done when |
| --- | --- | --- |
| 0 | Introduce `Provider` and `RoutedLLM`; move the Claude code into the `anthropic` adapter; move `MODELS` and `PRICES` into config. No behaviour change. | All current tests pass unchanged; Claude calls identical on the wire. |
| 1 | `openai-compatible` adapter, then `gemini`. Schema lowering, prompt-only structured output with repair, limiter, cost config. | A fake HTTP server test per adapter; a note resolves end to end on each. |
| 2 | Generalise key setup and the menu to providers and profiles. | Add a key for a second provider in the UI and switch profile without a restart. |
| 3 | Eval harness: a fixed set of notes on the kitchen show, run per profile, reporting take pass rate, QC fixed, rounds to resolve, cost and time. | A table per model to decide which job it can take. |
| 4 | Add new models as they ship: list models at setup, run the eval, promote into a job only if it matches or beats the current one on pass rate. | A new model is config plus an eval run. |

## What to expect from other models

- Strict grammar and the locality guard are the hard part for small or free models. Expect more rejected takes and more retries, which the code filter handles. Measure it in phase 3 before trusting a model with `build`.
- Keep `direct` on the strongest model you can afford, since it is rare and it is where judgement matters.
- Free tiers can use prompts for training. The UI should say so next to any free profile, and the show bible and episode text go in every prompt.
- The Claude Code route (the MCP server) needs none of this and stays the zero-cost option on a Claude plan.

## Not planned

Routing a Claude subscription login through the API, and fine-tuning. Both are out of scope.
