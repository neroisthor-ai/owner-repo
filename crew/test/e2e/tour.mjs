// Screenshots every page of the app. Usage: node test/e2e/tour.mjs [url] [outDir]
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(process.env.PW_NODE ?? "/opt/node-tools/");
const { chromium } = require("playwright");
const [url = "http://localhost:4310/", out = "/tmp/crew-shots"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(3000);
await page.getByRole("button", { name: /Continue/ }).click();
await page.waitForTimeout(2500);
for (const p of ["Review", "Edit", "Frame", "Plan", "Deliver"]) {
  await page.getByRole("button", { name: new RegExp(`^${p}`) }).first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/tour-${p}.png` });
}
await page.getByRole("button", { name: /Home|^$/ }).first().click().catch(() => {});
await browser.close();
