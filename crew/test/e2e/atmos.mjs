// Ultra quality on an open set: clouds, haze, god rays, occlusion compile and draw. Prints shader errors.
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_NODE ?? "/opt/node-tools/");
const { chromium } = require("playwright");
const [url = "http://localhost:4311/", out = "/tmp/crew-shots"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on("console", (m) => { if (/Shader Error|ERROR|rror:/.test(m.text()) && !/404/.test(m.text())) errs.push(m.text().slice(0, 900)); });
page.on("pageerror", (e) => errs.push("pageerror " + e.message));
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(3000);
await page.getByRole("button", { name: /Continue/ }).click();
await page.waitForTimeout(1500);
await page.evaluate(() => { window.__crew.store.set({ look: true, lookQ: 2 }); });
// look up at the sky: tilt every camera of the street shots upward
await page.evaluate(() => {
  const b = window.__crew.store.get().server.baked;
  for (const s of b.shots) if (b.sets[s.set]?.open) s.cam = s.cam.map((f) => [f[0], 1.6, f[2], f[0] + (f[3] - f[0]) * 0.2, 60, f[2] + (f[5] - f[2]) * 0.2, 50]);
  window.__crew.store.set({ server: { ...window.__crew.store.get().server, baked: b } });
});
const t = await page.evaluate(() => window.__crew.store.get().server.baked.shots.find((s) => s.id === "2A").cutStart + 0.3);
await page.evaluate((t) => window.__crew.clock.seek(t), t);
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/sky.png`, clip: { x: 0, y: 50, width: 1170, height: 500 } });
console.log("errors:", [...new Set(errs)]);
await browser.close();
