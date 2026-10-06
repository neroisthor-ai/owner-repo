// One command to work on a film with Claude Code: installs what is missing, starts the editor, then opens Claude Code
// in this folder (its .mcp.json registers the crew tools). Usage: npm run claude
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT ?? "4310";
const sh = process.platform === "win32";
const say = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) { console.error(`Node 20 or newer is needed (you have ${process.versions.node}). Get it from https://nodejs.org`); process.exit(1); }

if (!existsSync(join(root, "node_modules"))) {
  say("Installing dependencies (first run only)...");
  if (spawnSync("npm", ["install"], { cwd: root, stdio: "inherit", shell: sh }).status !== 0) process.exit(1);
}

const has = spawnSync("claude", ["--version"], { stdio: "ignore", shell: sh }).status === 0;
if (!has) {
  console.error("\nClaude Code isn't installed. Install it, sign in with your Claude account, then run this again:\n  https://docs.claude.com/en/docs/claude-code/setup\n");
  process.exit(1);
}

say(`Starting the editor on http://localhost:${port}`);
const server = spawn("npx", ["tsx", "src/cli.ts", "serve", "--port", port], { cwd: root, stdio: ["ignore", "inherit", "inherit"], shell: sh });
const stop = () => { try { server.kill(); } catch {} };
process.on("exit", stop);
process.on("SIGINT", () => { stop(); process.exit(0); });

say("Opening Claude Code. Approve the 'crew' tools when it asks, then try:  1D, the shock is too long");
const claude = spawn("claude", [], { cwd: root, stdio: "inherit", shell: sh });
claude.on("exit", (code) => { stop(); process.exit(code ?? 0); });
