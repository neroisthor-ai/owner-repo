// A stand-in Gemini for rehearsals: the real GeminiLLM and GeminiClient run unchanged, but each HTTP request is written to
// <dir>/<n>.request.json and the reply text is read from <n>.reply.txt (written by whoever plays the model).
// Usage from the eval: npx tsx scripts/eval.ts relay --pick 2,10 (RELAY_DIR defaults to /tmp/crew-relay)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GeminiClient } from "../src/llm/gemini.ts";
import { GeminiLLM } from "../src/llm/gemini-llm.ts";

export function relayLLM(dir = process.env.RELAY_DIR ?? "/tmp/crew-relay"): GeminiLLM {
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const fake = async (url: string | URL | Request, init?: RequestInit) => {
    const id = String(++n).padStart(3, "0");
    const body = JSON.parse(String(init?.body ?? "{}"));
    const model = String(url).match(/models\/([^:]+):/)?.[1] ?? "";
    writeFileSync(join(dir, `${id}.request.json`), JSON.stringify({ model, ...body }, null, 2));
    const reply = join(dir, `${id}.reply.txt`);
    const t0 = Date.now();
    while (!existsSync(reply)) {
      if (Date.now() - t0 > 30 * 60_000) return new Response(JSON.stringify({ error: { code: 504, message: "relay timeout" } }), { status: 504 });
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 200)); // let the writer finish
    const text = readFileSync(reply, "utf8");
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: Math.round(String(init?.body).length / 4), candidatesTokenCount: Math.round(text.length / 4) } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return new GeminiLLM({ client: new GeminiClient({ apiKey: "relay", fetch: fake as typeof fetch, sleep: async () => {} }) });
}
