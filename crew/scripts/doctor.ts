// `npm run doctor`: checks everything Crew AI on Gemini needs, in one go, and says exactly what to fix.
//   the key is set; the key works; each model id (Flash-Lite, Flash, Pro, TTS) exists for this key;
//   each text model answers a tiny structured request at its thinking level; the voice model returns audio.
// Live checks cost a handful of tokens. `--offline` checks only the configuration.
import "../src/env.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CREW_ROOT } from "../src/project.ts";

try { process.loadEnvFile(join(CREW_ROOT, ".env")); } catch { /* keys may come from the environment */ }
const offline = process.argv.includes("--offline");
const rows: [string, "ok" | "fix" | "warn" | "skip", string][] = [];
const row = (what: string, state: (typeof rows)[number][1], detail: string) => { rows.push([what, state, detail]); };

const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const { GEMINI_MODELS, GEMINI_THINKING, GeminiLLM, PRO_MODE, FLASH_GROUP, GEMINI_LADDERS } = await import("../src/llm/gemini-llm.ts");
const { GeminiClient } = await import("../src/llm/gemini.ts");
const tts = process.env.CREW_GEMINI_TTS ?? "gemini-3.8-flash-tts";

row(".env file", existsSync(join(CREW_ROOT, ".env")) ? "ok" : "warn", existsSync(join(CREW_ROOT, ".env")) ? join(CREW_ROOT, ".env") : "none yet: copy .env.example to .env, or paste the key in the Crew AI menu");
row("GEMINI_API_KEY", key ? "ok" : "fix", key ? `set (${key.slice(0, 4)}...${key.slice(-4)})` : "not set: add GEMINI_API_KEY=... to .env (Google AI Studio > Get API key)");
const jobs: [string, string, string][] = [
  ["Flash-Lite (reads notes, ranks)", GEMINI_MODELS.haiku, `CREW_GEMINI_LITE, thinking ${GEMINI_THINKING.haiku}`],
  ["Flash (builds takes, props, shots)", GEMINI_MODELS.sonnet, `CREW_GEMINI_FLASH, thinking ${GEMINI_THINKING.sonnet}`],
  ["Pro (plans, debugs, reviews)", GEMINI_MODELS.opus, `CREW_GEMINI_PRO, thinking ${GEMINI_THINKING.opus}${PRO_MODE === "flash" ? `; unused, CREW_PRO_MODE=flash` : ""}`],
  ["Voices (TTS)", tts, "CREW_GEMINI_TTS"],
];

if (key && !offline) {
  const client = new GeminiClient({ apiKey: key, maxRetries: 1 });
  let ids: string[] = [];
  try { ids = await client.listModels(); row("key works", "ok", `${ids.length} models available`); }
  catch (e) { row("key works", "fix", `Google refused the key or could not be reached: ${(e as Error).message}`); }
  const suggest = (want: string) => ids.filter((i) => i.includes(want.includes("lite") ? "flash-lite" : want.includes("tts") ? "tts" : want.includes("pro") ? "pro" : "flash")).slice(0, 4).join(", ");
  for (const [job, id, env] of jobs) {
    if (!ids.length) { row(job, "skip", `${id} (${env})`); continue; }
    row(job, ids.includes(id) ? "ok" : "fix", ids.includes(id) ? `${id} (${env})` : `"${id}" is not available to this key. Set ${env.split(",")[0]} to one of: ${suggest(id) || ids.slice(0, 4).join(", ")}`);
  }
  if (ids.length) {
    const llm = new GeminiLLM({ client });
    for (const [tier, label] of [["haiku", "Flash-Lite answers"], ["sonnet", "Flash answers"], ["opus", "Pro answers"]] as const) {
      if (!ids.includes(GEMINI_MODELS[tier])) { row(label, "skip", "model id missing"); continue; }
      const t0 = Date.now();
      const r = await llm.call<{ ok: boolean }>({ task: "route", role: "doctor", tier, system: ["You check that an API works."], prompt: 'Reply with {"ok": true}.', schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }, maxTokens: 2000 });
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (tier === "opus" && llm.standIn) {
        row("Pro's jobs", r.ok && r.data?.ok === true ? "ok" : "fix", r.ok ? `done by ${FLASH_GROUP} Flash calls on high thinking plus a final pass (${PRO_MODE === "flash" ? "CREW_PRO_MODE=flash" : "Pro isn't on this key's tier"}); answered in ${secs}s` : r.error ?? "no reply");
        continue;
      }
      row(label, r.ok && r.data?.ok === true ? "ok" : "fix", r.ok ? `structured reply in ${secs}s` : r.error ?? "no reply");
    }
    if (ids.includes(tts)) {
      try {
        const mod = await import("../src/voice/gemini-tts.ts").catch(() => null);
        if (!mod) row("Voices answer", "skip", "the Gemini voice engine is not installed in this build");
        else {
          const eng = new mod.GeminiTtsEngine();
          const pcm = await eng.synth("Testing.", { blend: [["af_heart", 1]], lang: "en-us", speed: 1 }, 1);
          const n = (pcm as { samples?: ArrayLike<number> }).samples?.length ?? (pcm as unknown as ArrayLike<number>).length ?? 0;
          row("Voices answer", n > 0 ? "ok" : "fix", n > 0 ? "audio returned" : "no audio in the reply");
        }
      } catch (e) { row("Voices answer", "fix", (e as Error).message); }
    }
  }
} else for (const [job, id, env] of jobs) row(job, "skip", `${id} (${env})${offline ? "" : ", needs the key"}`);

row("Flash ladder", "ok", `${GEMINI_LADDERS.sonnet.join(" > ")} (CREW_GEMINI_FLASH_LADDER): when one runs out of quota or is overloaded, the next takes over`);
row("Flash-Lite ladder", "ok", `${GEMINI_LADDERS.haiku.join(" > ")} (CREW_GEMINI_LITE_LADDER)`);
row("Storage", (process.env.CREW_STORAGE ?? "fs") === "fs" ? "ok" : "warn", `${process.env.CREW_STORAGE ?? "fs"} (Supabase is not connected yet)`);
row("Default crew", "ok", `CREW_LLM=${process.env.CREW_LLM ?? "auto"} (auto picks Claude if an Anthropic key is set, else Gemini, else offline)`);

const mark = { ok: "OK  ", fix: "FIX ", warn: "NOTE", skip: "--  " };
const w = Math.max(...rows.map((r) => r[0].length));
console.log("\nCrew doctor\n");
for (const [what, st, d] of rows) console.log(`  ${mark[st]}  ${what.padEnd(w)}  ${d}`);
const fixes = rows.filter((r) => r[1] === "fix").length;
console.log(fixes ? `\n${fixes} thing(s) to fix. Then run npm run doctor again.\n` : "\nReady. Start with npm start and pick Gemini in the Crew AI menu (or set CREW_LLM=gemini).\n");
process.exit(fixes ? 1 : 0);
