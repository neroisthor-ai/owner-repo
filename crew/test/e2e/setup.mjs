// Crew AI first-run: the menu asks for a key, and a bad key is refused with a reason. Usage: node test/e2e/setup.mjs [url]
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(process.env.PW_NODE ?? "/opt/node-tools/");
const { chromium } = require("playwright");
const [url = "http://localhost:4310/"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('[aria-label^="Continue"]')?.click());
await page.waitForTimeout(3000);
await page.click(".cm-btn");
assert.equal(await page.locator(".cm-crew").count(), 1, "the menu says who the crew is");
assert.equal(await page.locator(".cm-h", { hasText: "How thorough" }).count(), 0, "no thoroughness setting");
for (const [row, re] of [["Claude", /doesn't look like an Anthropic API key/], ["Gemini", /doesn't look like a Gemini API key/]]) {
  await page.locator(".cm-row", { hasText: row }).first().click();
  await page.waitForSelector(".cm-key input");
  assert.match(await page.getAttribute(".cm-key input", "placeholder"), row === "Gemini" ? /Gemini/ : /sk-ant/);
  await page.fill(".cm-key input", "not-a-key");
  await page.click(".cm-key button[type=submit]");
  await page.waitForSelector(".cm-key-err");
  assert.match(await page.textContent(".cm-key-err"), re);
}
await page.screenshot({ path: "/tmp/crew-shots/key.png", clip: { x: 800, y: 0, width: 800, height: 620 } });
assert.deepEqual(errors, []);
await browser.close();
console.log("setup e2e ok");
