// Renders a short part through the film renderer (accumulation passes, encoder, muxer) and saves the MP4.
// Usage: node test/e2e/render.mjs [url] [outDir]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
const require = createRequire(process.env.PW_NODE ?? "/opt/node-tools/");
const { chromium } = require("playwright");
const [url = "http://localhost:4310/", out = "/tmp/crew-render"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); });
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(2500);
let failed = 0;
for (const passes of [1, 8]) {
  const r = await page.evaluate(async ({ passes }) => {
    const X = window.__crew;
    X.setLook({ dof: true, fstop: 2.0 });
    const st = X.store.get().server, b = st.baked;
    const t0 = performance.now(), seen = [];
    try {
      const res = await window.CrewExt.renderPart(b, { start: 0, end: 0.5 }, { width: 640, height: 360, fps: b.fps, burn: { timecode: true, shot: true, subs: true }, passes }, { assets: st.assets, maxFrames: 6, onProgress: (d, t, x) => seen.push(x.passes) });
      const buf = new Uint8Array(await res.blob.arrayBuffer());
      return { ok: true, bytes: res.bytes, frames: res.frames, codec: res.codec, audio: res.audio, ms: Math.round(performance.now() - t0), passes: seen, head: Array.from(buf.slice(4, 12)), b64: btoa(String.fromCharCode(...buf.slice(0, 300000))) };
    } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  }, { passes });
  if (!r.ok) { failed++; console.log(`passes ${passes}: FAIL ${r.error}`); continue; }
  const file = `${out}/part_${passes}pass.mp4`;
  writeFileSync(file, Buffer.from(r.b64, "base64"));
  console.log(`passes ${passes}: ${r.frames} frames, ${r.bytes} bytes, ${r.codec}, audio ${r.audio}, ${r.ms} ms, per-frame passes ${r.passes}, ftyp ${String.fromCharCode(...r.head)}`);
  if (r.bytes < 1000) failed++;
}
console.log("errors:", errors.slice(0, 5));
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
