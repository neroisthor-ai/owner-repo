// Dialogue clips load and decode in the browser. Needs a server whose show has rendered voices.
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_NODE ?? "/opt/node-tools/");
const { chromium } = require("playwright");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.argv[2] ?? "http://localhost:4310/", { waitUntil: "load" });
await page.waitForTimeout(2500);
const r = await page.evaluate(async () => {
  const say = window.__crew.store.get().server.baked.audio.filter((e) => e.type === "say");
  await window.CrewExt.preloadClips(say);
  return say.map((e) => ({ src: e.src, ok: !!window.CrewExt.clipBuffer(e.src), dur: window.CrewExt.clipBuffer(e.src)?.duration }));
});
console.log(r);
console.log("errors:", errors);
let bad = r.filter((x) => x.src && !x.ok).length;
await browser.close();
process.exit(bad ? 1 : 0);
