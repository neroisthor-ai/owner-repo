// Screenshot the viewer at the start of each shot. Usage: node test/e2e/frames.mjs <url> <outDir> [prefix]
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire("/opt/node-tools/");
const { chromium } = require("playwright");
const [url = "http://localhost:4310/", out = "/tmp/crew-shots", prefix = "f"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(2500);
await page.getByRole("button", { name: /Continue/ }).click();
await page.waitForTimeout(1500);
const shots = await page.evaluate(() => window.__crew.store.get().server.baked.shots.map((s) => ({ id: s.id, t: s.cutStart + 0.4 })));
for (const s of shots) {
  await page.evaluate((t) => window.__crew.clock.seek(t), s.t);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${prefix}-${s.id}.png`, clip: { x: 0, y: 50, width: 1170, height: 500 } });
}
console.log("shots:", shots.map((s) => s.id).join(" "));
console.log("errors:", [...new Set(errors)].slice(0, 10));
await browser.close();
