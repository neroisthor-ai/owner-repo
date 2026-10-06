// Every button the bundle routes through sn() must have a registered handler. Lists any that don't.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire("/opt/node-tools/");
const { chromium } = require("playwright");
const src = readFileSync(new URL("../../web/app.js", import.meta.url), "utf8");
const names = new Set([...src.matchAll(/\bsn\("([^"]+)"/g)].map((m) => m[1]).concat([...src.matchAll(/what: "([^"]+)"/g)].map((m) => m[1])));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage();
await page.goto(process.argv[2] ?? "http://localhost:4310/", { waitUntil: "load" });
await page.waitForTimeout(2500);
const have = await page.evaluate(() => Object.keys(window.CrewExt.handlers));
const missing = [...names].filter((n) => !have.includes(n));
console.log(`${names.size} buttons route through sn(); ${have.length} handlers registered`);
console.log(missing.length ? "NO HANDLER:\n  " + missing.join("\n  ") : "every button has a handler");
await browser.close();
process.exit(missing.length ? 1 : 0);
