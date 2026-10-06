// Runs the browser tests against a throwaway server on the "sets" sample show (so it needs Chromium and WebGL,
// software GL is fine). Not part of `npm test`.   npm run e2e
import { spawn } from "node:child_process";
import { cpSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 4399, URL_ = `http://localhost:${PORT}/`;
const dir = mkdtempSync(join(tmpdir(), "crew-e2e-"));
cpSync(new URL("../../shows/sets", import.meta.url), dir, { recursive: true });
const server = spawn("npx", ["tsx", "src/cli.ts", "serve", dir, "--port", String(PORT)], { stdio: "ignore" });
const stop = () => { try { server.kill(); } catch {} rmSync(dir, { recursive: true, force: true }); };
process.on("exit", stop);

for (let i = 0; i < 60; i++) { try { if ((await fetch(URL_ + "api/state")).ok) break; } catch {} await sleep(500); }
await fetch(URL_ + "api/voices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engine: "walla" }) }); // rendered dialogue clips for the voice test

const steps = [
  ["every button has a handler", "stubs.mjs", [URL_]],
  ["film look on every shot", "frames.mjs", [URL_, join(tmpdir(), "crew-e2e-frames"), "look"]],
  ["atmosphere: sky, clouds, haze", "atmos.mjs", [URL_, join(tmpdir(), "crew-e2e-frames")]],
  ["dialogue clips load", "voice.mjs", [URL_]],
  ["exports download", "exports.mjs", [URL_, join(tmpdir(), "crew-e2e-dl")]],
  ["mattes, green screen, vertical", "media.mjs", [URL_, join(tmpdir(), "crew-e2e-media")]],
  ["render: 1 and 8 passes to MP4", "render.mjs", [URL_, join(tmpdir(), "crew-e2e-render")]],
];
let failed = 0;
for (const [name, file, args] of steps) {
  const t0 = Date.now();
  const r = await new Promise((ok) => { const p = spawn("node", [new URL(file, import.meta.url).pathname, ...args], { stdio: "inherit" }); p.on("exit", ok); });
  console.log(`${r === 0 ? "PASS" : "FAIL"}  ${name} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
  if (r !== 0) failed++;
}
stop();
process.exit(failed ? 1 : 0);
