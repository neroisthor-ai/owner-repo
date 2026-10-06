// Runs a model-written prop builder in a node:vm with only three.js and the prop helpers.
// The context has no require, process, fetch or timers; a source scan also rejects the usual ways out of a vm.
// This is a guard against honest mistakes and casual escapes, not a hard security boundary.
import vm from "node:vm";
import * as THREE from "three";
import * as core from "../../library/props/core.js";

export type RunResult = { ok: true; group: THREE.Group } | { ok: false; error: string };

/** The code from a model reply: the first fenced block, or the whole reply when it is raw code. */
export function extractCode(reply: string): string {
  const fenced = reply.match(/```(?:js|javascript|ts|typescript)?[ \t]*\r?\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const open = reply.match(/```(?:js|javascript)?[ \t]*\r?\n([\s\S]*)$/); // cut off before the closing fence
  return (open ? open[1] : reply).trim();
}

/** Drop import lines and `export` so the function can run as a plain script. */
export function stripModule(code: string): string {
  return code
    .replace(/^[ \t]*import\b[\s\S]*?\bfrom\s*["'][^"']*["'][ \t]*;?[ \t]*$/gm, "")
    .replace(/^[ \t]*import\s*["'][^"']*["'][ \t]*;?[ \t]*$/gm, "")
    .replace(/^[ \t]*export\s+default\s+(?=function|class)/gm, "")
    .replace(/^[ \t]*export\s+(?=function|const|let|var|class|async)/gm, "")
    .replace(/^[ \t]*export\s*\{[^}]*\}[ \t]*(?:from\s*["'][^"']*["'])?;?[ \t]*$/gm, "");
}

const FORBIDDEN: [RegExp, string][] = [
  [/\brequire\b/, "require"], [/\bprocess\b/, "process"], [/\bimport\s*\(/, "import()"], [/\bimport\.meta\b/, "import.meta"],
  [/\bglobalThis\b/, "globalThis"], [/\b(?:eval|Function|AsyncFunction|Reflect|Proxy|WebAssembly)\b/, "eval/Function/Reflect/Proxy"],
  [/\bfetch\b|\bXMLHttpRequest\b|\bWebSocket\b/, "network access"], [/\b(?:setTimeout|setInterval|setImmediate)\b/, "timers"],
  [/\bconstructor\b|__proto__|\bgetPrototypeOf\b/, "constructor/prototype access"],
];

export function runBuilder(code: string, fnName: string, args: object = {}): RunResult {
  if (!/^[A-Za-z_$][\w$]*$/.test(fnName)) return { ok: false, error: `bad function name "${fnName}"` };
  const src = stripModule(code);
  for (const [re, what] of FORBIDDEN) if (re.test(src)) return { ok: false, error: `the sandbox only allows THREE and the prop helpers: remove the use of ${what}` };
  const { box, cyl, mesh, mat, group, merged, mergeGeometries, TM, finish, rng } = core;
  const ctx = vm.createContext({ THREE, box, cyl, mesh, mat, group, merged, mergeGeometries, TM, finish, rng, Math, console: { log() {}, warn() {}, error() {} }, __args: args, __out: undefined }, { codeGeneration: { strings: false, wasm: false } });
  try {
    vm.runInContext(`${src}\n;__out = typeof ${fnName} === "function" ? ${fnName}(__args) : undefined;\nif (__out === undefined && typeof ${fnName} !== "function") throw new Error("no function named ${fnName} was defined");`, ctx, { timeout: 2000, filename: "prop.js" });
  } catch (e) {
    const err = e as Error;
    const msg = err?.message ?? String(e);
    return { ok: false, error: /timed out/i.test(msg) ? "the builder ran longer than 2 seconds (infinite or huge loop?)" : `${err?.name ?? "Error"}: ${msg}` };
  }
  const out = (ctx as { __out?: THREE.Object3D }).__out;
  if (!out || (out as THREE.Group).isGroup !== true) return { ok: false, error: `${fnName}() must return a THREE.Group (use return finish(g, "<id>", {...}))` };
  return { ok: true, group: out as THREE.Group };
}
