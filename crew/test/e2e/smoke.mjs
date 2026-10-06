// Browser smoke test for the v9 frontend. Needs the server running (npm start), Chromium and Playwright.
// PW_NODE = a directory whose node_modules holds playwright, CHROMIUM = the browser binary.
// Usage: node test/e2e/smoke.mjs [url] [shotsDir]
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(process.env.PW_NODE ?? "/opt/node-tools/");
const { chromium } = require("playwright");
const url = process.argv[2] ?? "http://localhost:4310/";
const out = process.argv[3] ?? "/tmp/crew-shots";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [], failed = [], api = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.url().includes("/api/")) api.push(`${r.status()} ${r.url()}`); if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/review.png` });
page.on("response", () => {});
async function shot(name) { await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/${name}.png` }); }
await page.getByRole("button", { name: /Continue/ }).click();
await shot("review2");
for (const label of ["Edit", "Deliver", "Create"]) {
  const b = page.getByRole("button", { name: new RegExp(`^${label}`) }).first();
  if (await b.count()) { await b.click(); await shot(label.toLowerCase()); } else console.log("no button", label);
}
console.log("buttons:", await page.locator("button").evaluateAll((b) => b.map((x) => x.textContent.trim().slice(0, 20)).filter(Boolean).slice(0, 60)));
console.log("title:", await page.title());
console.log("canvas:", await page.locator("canvas").count());
console.log("api:", api.join(" | "));
console.log("failed:", failed);
console.log("errors:", errors.slice(0, 20));
await browser.close();
