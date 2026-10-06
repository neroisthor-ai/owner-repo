// Clicks every Deliver/Create export and checks a file arrives. Usage: node test/e2e/exports.mjs [url] [outDir]
import { createRequire } from "node:module";
import { mkdirSync, statSync } from "node:fs";
const require = createRequire(process.env.PW_NODE ?? "/opt/node-tools/");
const { chromium } = require("playwright");
const [url = "http://localhost:4310/", out = "/tmp/crew-dl"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); });
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(2500);
await page.getByRole("button", { name: /Continue/ }).click();
await page.waitForTimeout(1000);
const toastText = () => page.evaluate(() => window.__crew.store.get().toast?.text ?? "");
const results = [];
async function go(page_) { await page.getByRole("button", { name: new RegExp(`^${page_}`) }).first().click(); await page.waitForTimeout(600); }
async function click(label, { download = true, timeout = 240000 } = {}) {
  const btn = page.getByRole("button", { name: label }).first();
  if (!(await btn.count())) { results.push({ label: String(label), ok: false, note: "no such button" }); return; }
  await page.evaluate(() => window.__crew.store.set({ toast: null }));
  const dl = download ? page.waitForEvent("download", { timeout }).catch(() => null) : null;
  await btn.click();
  const d = dl ? await dl : null;
  await page.waitForTimeout(300);
  const t = await toastText();
  let file = null, size = 0;
  if (d) { file = d.suggestedFilename(); await d.saveAs(`${out}/${file}`); size = statSync(`${out}/${file}`).size; }
  const stub = /isn't wired up yet/.test(t);
  results.push({ label: String(label), ok: download ? !!d : !stub, file, size, toast: t.slice(0, 120) });
}
const only = process.env.ONLY ? new RegExp(process.env.ONLY, "i") : null;
const plan = [
  ["Deliver", [/glTF/, /Maya/, /Blender/, /After Effects/, /Unreal/]],
  ["Deliver", [/Print \/ PDF/, /Images \(\.zip\)/, /Shot list \(\.csv\)/, /Print shot list/, /Print plans/, /Build shoot pack/]],
  ["Deliver", [/OpenTimelineIO/, /^EDL/, /Final Cut XML/]],
  ["Deliver", [/Clips per shot/]],
  ["Deliver", [/Compare with editor/]],
];
// slow in software GL: set SLOW=1 to include the per-shot clips
const SLOW = !!process.env.SLOW;
for (const [pg, labels] of plan) {
  await go(pg);
  for (const l of labels) {
    if (only && !only.test(String(l))) continue;
    if (!SLOW && /Clips per shot/.test(String(l))) continue;
    const noDownload = /Unreal|Print|Compare/.test(String(l));
    await click(l, { download: !noDownload });
  }
}
for (const r of results) console.log(r.ok ? "ok  " : "FAIL", r.label.padEnd(26), r.file ?? "", r.size || "", r.toast ?? r.note ?? "");
console.log("errors:", [...new Set(errors)].slice(0, 8));
await browser.close();
process.exit(results.some((r) => !r.ok) || errors.length ? 1 : 0);
