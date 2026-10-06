import { test } from "node:test";
import assert from "node:assert/strict";
import { GeminiTtsEngine } from "../src/voice/gemini-tts.ts";
import { pickEngine, type VoiceDesign } from "../src/voice/engines.ts";
import { GeminiClient } from "../src/llm/gemini.ts";

const fem: VoiceDesign = { blend: [["bf_emma", 0.6], ["af_heart", 0.4]], lang: "en-gb", speed: 1 };
const mal: VoiceDesign = { blend: [["am_adam", 1]], lang: "en-us", speed: 1 };

const pcmB64 = (n: number) => { const b = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 10) * 8000), i * 2); return b.toString("base64"); };
const audio = (n: number, rate = 24000) => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: `audio/L16;codec=pcm;rate=${rate}`, data: pcmB64(n) } }] } }] });

function rig(replies: Array<{ status?: number; body: unknown }>, extra: object = {}) {
  const calls: { url: string; headers: any; body: any }[] = [];
  const sleeps: number[] = [];
  const fetchFn = (async (url: string, init: any) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  const eng = new GeminiTtsEngine({ apiKey: "k", fetch: fetchFn, sleep: async (ms) => { sleeps.push(ms); }, voices: {}, ...extra });
  return { eng, calls, sleeps };
}

test("request shape, voice per sex, direction", async () => {
  const { eng, calls } = rig([{ body: audio(2400) }]);
  const pcm = await eng.synth("I was checking the fridge.", fem, 1, "Say quietly and guiltily");
  const c = calls[0];
  assert.match(c.url, /\/v1beta\/models\/gemini-3\.8-flash-tts:generateContent$/);
  assert.equal(c.headers["x-goog-api-key"], "k");
  assert.deepEqual(c.body.generationConfig.responseModalities, ["AUDIO"]);
  assert.equal(c.body.contents[0].parts[0].text, 'Say quietly and guiltily: "I was checking the fridge."');
  assert.ok(["Kore", "Aoede", "Leda", "Zephyr"].includes(c.body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName));
  assert.equal(pcm.sampleRate, 24000);
  assert.equal(pcm.samples.length, 2400);
  await eng.synth("hi", mal, 1);
  assert.ok(["Puck", "Charon", "Fenrir", "Orus"].includes(calls[1].body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName));
  assert.match(calls[1].body.contents[0].parts[0].text, /^Say naturally: "hi"$/);
  await eng.synth("hi", mal, 1.2);
  assert.match(calls[2].body.contents[0].parts[0].text, /^Say naturally, a little faster: /);
  await eng.synth("hi", mal, 0.8);
  assert.match(calls[3].body.contents[0].parts[0].text, /a little slower/);
});

test("voice is deterministic", async () => {
  const a = rig([{ body: audio(100) }]), b = rig([{ body: audio(100) }]);
  await a.eng.synth("x", fem, 1); await b.eng.synth("x", fem, 1);
  assert.deepEqual(a.calls[0].body.generationConfig, b.calls[0].body.generationConfig);
});

test("resamples other rates to 24 kHz", async () => {
  const { eng } = rig([{ body: audio(1600, 16000) }]);
  const pcm = await eng.synth("x", mal, 1);
  assert.equal(pcm.sampleRate, 24000);
  assert.equal(pcm.samples.length, 2400);
});

test("env voice override", async () => {
  const old = process.env.CREW_GEMINI_VOICES;
  process.env.CREW_GEMINI_VOICES = "bf_emma=Charon, kiran=Puck";
  try {
    const calls: any[] = [];
    const fetchFn = (async (_u: string, init: any) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify(audio(100))); }) as unknown as typeof fetch;
    const eng = new GeminiTtsEngine({ apiKey: "k", fetch: fetchFn });
    await eng.synth("x", fem, 1);
    assert.equal(calls[0].generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Charon");
    assert.equal(eng.voiceForChar("Kiran", mal), "Puck");
  } finally { if (old === undefined) delete process.env.CREW_GEMINI_VOICES; else process.env.CREW_GEMINI_VOICES = old; }
});

test("errors: 404, auth, no audio, retry", async () => {
  await assert.rejects(rig([{ status: 404, body: { error: { message: "nope" } } }]).eng.synth("x", mal, 1), /CREW_GEMINI_TTS/);
  await assert.rejects(rig([{ status: 403, body: { error: { message: "bad key" } } }]).eng.synth("x", mal, 1), /authentication failed/);
  await assert.rejects(rig([{ body: { candidates: [{ content: { parts: [{ text: "hello" }] }, finishReason: "STOP" }] } }]).eng.synth("x", mal, 1), /no audio/);
  const r = rig([{ status: 429, body: { error: { message: "slow" } } }, { status: 503, body: {} }, { body: audio(100) }]);
  assert.equal((await r.eng.synth("x", mal, 1)).samples.length, 100);
  assert.equal(r.sleeps.length, 2);
});

test("pickEngine auto prefers gemini only with a key", () => {
  const keep = { ...process.env };
  try {
    for (const k of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "CREW_TTS", "CREW_TTS_CMD"]) delete process.env[k];
    assert.notEqual(pickEngine("auto").name, "gemini");
    process.env.GEMINI_API_KEY = "k";
    assert.equal(pickEngine("auto").name, "gemini");
    process.env.CREW_TTS = "walla";
    assert.equal(pickEngine().name, "walla");
    delete process.env.CREW_TTS;
    assert.equal(pickEngine("gemini").name, "gemini");
  } finally { process.env = keep; }
});

test("image parts precede the text part", async () => {
  const calls: any[] = [];
  const fetchFn = (async (_u: string, init: any) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] })); }) as unknown as typeof fetch;
  const c = new GeminiClient({ apiKey: "k", fetch: fetchFn, sleep: async () => {} });
  await c.generate({ model: "m", system: "s", prompt: "P", thinking: "low", images: [{ mimeType: "image/png", data: "AAAA" }] });
  assert.deepEqual(calls[0].contents[0].parts, [{ inlineData: { mimeType: "image/png", data: "AAAA" } }, { text: "P" }]);
});
