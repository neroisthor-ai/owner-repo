// Timeline editing: import a picture with a green screen and a sound, key, split, drag, and see them on the timeline.
// Usage: node test/e2e/edit.mjs [url] [outDir]
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(process.env.PW_NODE ?? "/opt/node-tools/");
const { chromium } = require("playwright");
const [url = "http://localhost:4310/", out = "/tmp/crew-edit"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('[aria-label^="Continue"]')?.click());
await page.waitForTimeout(3500);
await page.evaluate(() => window.__crew.go("edit"));
await page.waitForTimeout(1500);

// a 320x180 picture: green screen with a red square in the middle
const png = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 320; c.height = 180; const g = c.getContext("2d"); g.fillStyle = "#00ff00"; g.fillRect(0, 0, 320, 180); g.fillStyle = "#e0301e"; g.fillRect(110, 50, 100, 80); return c.toDataURL("image/png").split(",")[1]; });
const wav = (() => { const n = 8000, b = Buffer.alloc(44 + n * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i * 0.3) * 12000), 44 + i * 2); return b; })();

assert.equal(await page.locator(".xe-bar").count(), 1, "Edit bar is on the Edit page");
await page.setInputFiles("section[aria-label=Media] input[type=file]", [{ name: "greenscreen.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") }, { name: "beep.wav", mimeType: "audio/wav", buffer: wav }]);
await page.waitForSelector(".xe-clip", { timeout: 10000 });
await page.waitForTimeout(500);
assert.equal(await page.locator(".xe-clip").count(), 2, "two clips imported");
assert.equal(await page.locator('.xe-lane[data-track="V2"] .xe-clip').count(), 1, "picture on the overlay lane");
assert.equal(await page.locator('.xe-lane[data-track="A3"] .xe-clip').count(), 1, "sound on Your audio");

// key it and look at the live overlay: the red square stays, the green is gone
await page.locator('.xe-lane[data-track="V2"] .xe-clip').click();
await page.evaluate(() => { window.__crew.clock.seek(1); });
await page.waitForSelector(".xe-insp");
await page.locator(".xe-insp input[type=checkbox]").nth(0).check();
await page.waitForTimeout(600);
const px = await page.evaluate(() => {
  const all = [...document.querySelectorAll(".crew-user-overlay")], c = all.find((x) => x.width > 0);
  if (!c) return { sourceMonitorHasOverlay: false, n: all.length };
  const g = c.getContext("2d"), at = (fx, fy) => Array.from(g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data);
  return { centre: at(0.5, 0.5), corner: at(0.05, 0.05), w: c.width };
});
console.log("overlay pixels", JSON.stringify(px));
assert.ok(px.centre, "the program monitor has the overlay and the Source monitor does not");
assert.ok(px.centre[3] > 200 && px.centre[0] > 180 && px.centre[1] < 90, "the subject shows");
assert.equal(px.corner[3], 0, "the green screen is keyed out");

// split at the playhead with S
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press("s");
await page.waitForTimeout(300);
assert.equal(await page.locator('.xe-lane[data-track="V2"] .xe-clip').count(), 2, "S splits the clip under the playhead");

// drag the first piece to the right
const first = page.locator('.xe-lane[data-track="V2"] .xe-clip').first();
const box = await first.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 6 }); await page.mouse.up();
const moved = await page.locator('.xe-lane[data-track="V2"] .xe-clip').first().boundingBox();
assert.ok(Math.abs(moved.x - box.x) > 40, "dragging moves the clip");

// Ctrl+Z steps the timeline edit back (one Undo for edits and crew changes)
await page.keyboard.press("Control+z");
await page.waitForTimeout(300);
const back = await page.locator('.xe-lane[data-track="V2"] .xe-clip').first().boundingBox();
assert.ok(Math.abs(back.x - box.x) < 6, "Undo puts the dragged clip back");

// it survives a reload (clips in localStorage, media in IndexedDB)
await page.screenshot({ path: `${out}/edit.png` });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('[aria-label^="Continue"]')?.click());
await page.waitForTimeout(3500);
await page.evaluate(() => window.__crew.go("edit"));
await page.waitForTimeout(2500);
assert.ok((await page.locator(".xe-clip").count()) >= 3, "clips come back after a reload");
console.log("errors:", errors);
assert.deepEqual(errors, []);
await browser.close();
console.log("edit e2e ok");
