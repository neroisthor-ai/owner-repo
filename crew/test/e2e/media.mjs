// Backgrounds (matte, green screen, blurred set) and reframed renders. Saves PNGs and an MP4 for a look.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire("/opt/node-tools/");
const { chromium } = require("playwright");
const [url = "http://localhost:4311/", out = "/tmp/crew-media"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); });
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(2500);
const res = await page.evaluate(async () => {
  const M = await import("/crew/exports/media.js");
  const b64 = async (blob) => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); };
  const b = window.__crew.store.get().server.baked, t = b.shots[0].cutStart + 1.0, o = {};
  for (const bg of ["scene", "alpha", "green", "blur"]) {
    const v = await M.stillViewer(640, 360, { look: bg === "scene", spp: 1, bg });
    try {
      const c = M.drawFrame(v, t, bg);
      const d = c.getContext("2d").getImageData(0, 0, 640, 360).data;
      let transparent = 0, opaque = 0;
      for (let i = 3; i < d.length; i += 4) { if (d[i] < 8) transparent++; else if (d[i] > 247) opaque++; }
      const blob = await M.toBlob(c);
      o[bg] = { transparent, opaque, b64: await b64(blob) };
    } finally { v.dispose(true); }
  }
  // a vertical render that follows the subject
  const r = await window.CrewExt.renderPart(b, { start: t, end: t + 0.5 }, { width: 540, height: 960, fps: b.fps, burn: { timecode: false, shot: false, subs: false }, passes: 1, reframe: { mode: "auto" } }, { assets: window.__crew.store.get().server.assets, maxFrames: 8 });
  o.vertical = { bytes: r.bytes, codec: r.codec, b64: await b64(r.blob) };
  return o;
});
for (const k of ["scene", "alpha", "green", "blur"]) { writeFileSync(`${out}/${k}.png`, Buffer.from(res[k].b64, "base64")); console.log(k, "transparent px", res[k].transparent, "opaque px", res[k].opaque); }
writeFileSync(`${out}/vertical.mp4`, Buffer.from(res.vertical.b64, "base64"));
console.log("vertical", res.vertical.bytes, res.vertical.codec);
console.log("errors:", errors.slice(0, 5));
await browser.close();
