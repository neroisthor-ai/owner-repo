// The prop maker: Pro writes a spec when the request has no size, Flash writes the builder, code checks it in a
// sandbox and explains failures back, Pro takes over if Flash cannot, then Pro reviews a description of the result.
// Plan: docs/ASSETS.md ("The common loop", "3D props"). Steps 4 and 5 there (preview, vision critique) are not built yet.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_META } from "../../library/props/meta.js";
import { MODELS, type LLM } from "../claude/llm.ts";
import type { Tier } from "../crew/roles.ts";
import { settingsFor } from "../llm/capability.ts";
import { checkProp, describeProp, failureText, type Check, type Measured, type PropCheck, type PropSpec } from "./checks.ts";
import { extractCode, runBuilder } from "./sandbox.ts";
import { GENERATED_DIR, idProblem, saveProp, type GeneratedMeta } from "./store.ts";

export interface PropRequest { id: string; description: string; size?: [number, number, number]; placement?: string }
export interface PropEvent { step: "spec" | "build" | "repair" | "escalate" | "review" | "revise" | "saved"; attempt?: number; ok?: boolean; detail?: string }
export interface PropOptions {
  emit?: (e: PropEvent) => void;
  /** model id behind a tier (sizes the repair rounds and is recorded as the author); defaults to the llm's own */
  modelFor?: (tier: Tier) => string;
  /** where accepted props are stored; default library/props/generated */
  dir?: string;
  /** false: check but do not store */
  save?: boolean;
}
export interface PropResult {
  ok: boolean;
  id: string;
  code: string;
  checks: Check[];
  measured?: Measured;
  attempts: number;
  /** present when stored */
  meta?: GeneratedMeta;
  error?: string;
}

const PLACEMENTS = ["front", "at", "behind", "wall", "ceiling", "onSurface", "flat"];
const LIB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "library", "props");

const SPEC_SCHEMA = {
  type: "object",
  properties: {
    size: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "bounding box [width x, height y, depth z] in metres" },
    parts: { type: "array", items: { type: "object", properties: { name: { type: "string" }, shape: { type: "string" }, colour: { type: "string" }, where: { type: "string" } }, required: ["name", "shape", "colour", "where"] } },
    placement: { type: "string", enum: PLACEMENTS },
  },
  required: ["size", "parts", "placement"],
};
const REVIEW_SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" }, fixes: { type: "array", items: { type: "string" } } },
  required: ["ok", "fixes"],
};

const SYSTEM = `You write 3D props for an animated film as JavaScript builder functions using three.js and a few helpers. Reply with ONE function (plus tiny helpers if needed) in one \`\`\`js block, nothing else.

AVAILABLE (already in scope; do not import anything, do not use require, process, fetch, timers, eval):
- THREE: the three.js namespace
- mat(color, opts?): cached MeshStandardMaterial; opts are material params, e.g. { roughness: 0.4, metalness: 0.8 }
- mesh(geometry, material, parent, x?, y?, z?): adds a mesh to parent at that position, returns it
- box(parent, w, h, d, material, x?, y?, z?): a box whose BOTTOM sits at y (not centred)
- cyl(parent, rTop, rBottom, h, material, x?, y?, z?, segments = 16): a cylinder whose BOTTOM sits at y
- group(parent, x?, y?, z?, rotationY?): a child THREE.Group
- merged(parent, geometries, material), mergeGeometries(geos), TM(x,y,z,sx,sy,sz,rx,ry,rz): geometry helpers
- rng(seed): seeded random (no Math.random)
- finish(g, id, meta): labels the prop; always \`return finish(g, "<id>", { ... })\`

CONVENTIONS: units are metres. +y up, +z is the front (towards camera), +x is the right. The prop stands on y = 0 and its bounding box is centred on x = 0 and z = 0 (place parts so that holds, including spouts, handles and other overhangs). Every part must touch the rest. No textures, no lights, no randomness.

GEOMETRY TRAPS: faces point the way the vertices wind. For LatheGeometry list the profile points from the bottom up (rising y) with the outside at larger x, or the surface is inside out and invisible; open shells (lathe, tubes, planes) are safest with side: THREE.DoubleSide in mat(). Check every part's size and position against the numbers in the spec.`;

/** Source of one exported builder function in a library module, by brace matching. */
function builderSource(module: string, id: string): string | null {
  try {
    const src = readFileSync(join(LIB, `${module}.js`), "utf8");
    const at = src.search(new RegExp(`^export function ${id}\\b`, "m"));
    if (at < 0) return null;
    const open = src.indexOf("{", src.indexOf(")", at));
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
    }
  } catch { /* no example */ }
  return null;
}

/** A real library builder of similar placement (and size) to show the style. */
export function pickExample(placement: string, size?: [number, number, number]): { id: string; code: string } | null {
  const vol = size ? Math.cbrt(size[0] * size[1] * size[2]) : 0;
  const cands = Object.values(BASE_META)
    .filter((m) => m.placement === placement && m.module === "interior" && m.size[0] * m.size[1] * m.size[2] > 0)
    .map((m) => ({ m, d: size ? Math.abs(Math.log(Math.cbrt(m.size[0] * m.size[1] * m.size[2]) / vol)) : 0 }))
    .sort((a, b) => a.d - b.d || a.m.id.localeCompare(b.m.id));
  for (const { m } of cands) {
    const code = builderSource(m.module, m.id);
    if (code && code.length <= 3500) return { id: m.id, code };
  }
  return null;
}

export const inferPlacement = (size: [number, number, number]) => (Math.max(...size) <= 0.5 ? "onSurface" : "front");

const cm = (v: number) => `${Math.round(v * 1000) / 10} cm`;

function specText(req: PropRequest, placement: string, size: [number, number, number] | undefined, parts: string, o: { maxTris: number; maxMaterials: number }): string {
  return [
    `THE PROP: ${req.description}`,
    `- Function: \`export function ${req.id}(opts = {})\`, returning \`finish(g, "${req.id}", ${placement === "onSurface" ? "{ onSurface: true }" : "{}"})\`.`,
    size ? `- Whole prop bounding box: ${cm(size[0])} wide (x), ${cm(size[1])} tall (y), ${cm(size[2])} deep (z), each within 12%.` : "- Real-world size: pick sensible real-world dimensions.",
    `- Placement: ${placement}${placement === "wall" || placement === "ceiling" ? " (hung, so it need not touch y = 0)" : "; lowest point exactly at y = 0"}. Centred on x = 0 and z = 0.`,
    ...(parts ? [parts] : []),
    `- Limits: at most ${o.maxMaterials} materials, at most ${o.maxTris} triangles, no textures, no lights, no randomness.`,
  ].join("\n");
}

const tryRun = (code: string, id: string, spec: PropSpec): { check: PropCheck; group?: import("three").Group } | { error: string } => {
  const r = runBuilder(code, id);
  if (!r.ok) return { error: r.error };
  return { check: checkProp(r.group, spec), group: r.group };
};

export async function makeProp(llm: LLM, req: PropRequest, o: PropOptions = {}): Promise<PropResult> {
  const emit = o.emit ?? (() => {});
  const dir = o.dir ?? GENERATED_DIR;
  const model = (t: Tier) => o.modelFor?.(t) ?? llm.modelFor?.(t) ?? MODELS[t];
  const fail = (error: string, code = "", checks: Check[] = [], attempts = 0, measured?: Measured): PropResult => ({ ok: false, id: req.id, code, checks, measured, attempts, error });

  const bad = idProblem(req.id);
  if (bad) return fail(bad);
  if (!req.description?.trim()) return fail("a prop needs a description");
  if (req.size && (req.size.length !== 3 || req.size.some((v) => !(v > 0 && v < 100)))) return fail("size must be [w, h, d] in metres, each above 0");

  // 1. spec: Pro fixes real-world dimensions when the request has none
  let size = req.size, placement = req.placement, parts = "";
  if (!size) {
    const r = await llm.call<{ size: number[]; parts: { name: string; shape: string; colour: string; where: string }[]; placement: string }>({
      task: "plan", role: "props", tier: "opus", schema: SPEC_SCHEMA, maxTokens: 4000,
      system: ["You are the prop designer for an animated film. You turn a request for a prop into exact real-world dimensions and a parts list that a builder can follow."],
      prompt: `Request: ${req.description}\n\nGive the bounding box [width x, height y, depth z] in metres of a realistic ${req.id.replace(/_/g, " ")}, the parts (name, shape such as box/cylinder/sphere/lathe/tube, colour as a hex code, where it sits relative to the body, with +x right, +y up, +z front), and the placement (${PLACEMENTS.join(", ")}).`,
    });
    const s = r.data;
    if (r.ok && s && Array.isArray(s.size) && s.size.length === 3 && s.size.every((v) => Number.isFinite(v) && v > 0 && v < 100)) {
      size = s.size as [number, number, number];
      placement ??= PLACEMENTS.includes(s.placement) ? s.placement : undefined;
      parts = `- Parts:\n${(s.parts ?? []).map((p) => `  - ${p.name}: ${p.shape}, ${p.colour}, ${p.where}`).join("\n")}`;
      emit({ step: "spec", ok: true, detail: `${size.map(cm).join(" x ")}` });
    } else emit({ step: "spec", ok: false, detail: r.error ?? "the spec was unusable; building from the description alone" });
  }
  placement ??= size ? inferPlacement(size) : "front";
  const spec: PropSpec = { id: req.id, size, placement };
  const lim = { maxTris: spec.maxTris ?? 20000, maxMaterials: spec.maxMaterials ?? 8 };
  const text = specText(req, placement, size, parts, lim);
  const ex = pickExample(placement, size);
  const example = ex ? `EXAMPLE (a library prop, for style only; write your own function named ${req.id}):\n\`\`\`js\n${ex.code}\n\`\`\`\n\n` : "";

  let attempts = 0;
  let author: Tier = "sonnet";
  const ask = async (tier: Tier, task: "build" | "repair", prompt: string): Promise<{ code: string } | { error: string }> => {
    attempts++;
    const r = await llm.call({ task, role: "props", tier, system: [SYSTEM], prompt, maxTokens: 12000 });
    if (!r.ok) return { error: r.error ?? "the model call failed" };
    const code = extractCode(r.text);
    return code ? { code } : { error: "the model returned no code" };
  };
  const repairPrompt = (code: string, failures: string, extra = "") => `${example}${text}\n\nYOUR PREVIOUS CODE:\n\`\`\`js\n${code}\n\`\`\`\n\nIT FAILED THESE CHECKS (measured by code):\n${failures}\n${extra}\nFix exactly these problems and keep everything else. Reply with the whole corrected function in one \`\`\`js block.`;
  /** run + check one candidate; failures as text, or null when it passes */
  const judge = (code: string) => {
    const r = tryRun(code, req.id, spec);
    if ("error" in r) return { failures: `- the code did not run: ${r.error}`, checks: [] as Check[], measured: undefined as Measured | undefined, group: undefined };
    return { failures: r.check.pass ? null : failureText(r.check), checks: r.check.checks, measured: r.check.measured, group: r.group };
  };

  // 2-3. Flash writes, code checks, failures go back for the grip's number of repairs; then Pro writes it
  const repairs = Math.max(2, settingsFor(model("sonnet"), "prop3d").repairs);
  let code = "", failures: string | null = "", j: ReturnType<typeof judge> | null = null;
  const seen: string[] = [];
  for (let round = 0; round <= repairs + 1; round++) {
    const pro = round === repairs + 1;
    if (pro) { author = "opus"; emit({ step: "escalate", attempt: attempts + 1, detail: "the builder could not pass the checks; Pro writes it" }); }
    const prompt = round === 0 ? `${example}${text}\n\nWrite the function now.`
      : repairPrompt(code, failures ?? "", pro ? `\nEarlier rounds also failed on:\n${seen.map((s) => `- ${s}`).join("\n")}\n` : "");
    emit({ step: round === 0 ? "build" : "repair", attempt: attempts + 1 });
    const got = await ask(pro ? "opus" : "sonnet", round === 0 ? "build" : "repair", prompt);
    if ("error" in got) { if (pro || round === 0) return fail(got.error, code, j?.checks, attempts, j?.measured); failures = `- ${got.error}`; continue; }
    code = got.code;
    j = judge(code);
    failures = j.failures;
    emit({ step: round === 0 ? "build" : "repair", attempt: attempts, ok: failures === null, detail: failures ?? undefined });
    if (failures === null) break;
    seen.push(...failures.split("\n").map((l) => l.replace(/^- /, "").slice(0, 120)));
  }
  if (failures !== null || !j?.group || !j.measured) return fail(`the prop did not pass the checks after ${attempts} attempts:\n${failures}`, code, j?.checks, attempts, j?.measured);

  // 4. Pro reviews a description of the result against the request
  const rv = await llm.call<{ ok: boolean; fixes: string[] }>({
    task: "review", role: "props", tier: "opus", schema: REVIEW_SCHEMA, maxTokens: 3000,
    system: ["You review a 3D prop for an animated film from a description of its parts and measurements. You cannot see it, so judge from the numbers."],
    prompt: `Request: ${req.description}\n\n${text}\n\n${describeProp(j.group, j.measured)}\n\nDoes the result match the request: the right parts, in the right places (spout side, handle direction, lid on top), the right colours, plausible proportions? Reply ok true with no fixes, or ok false with a short list of concrete fixes (what to change, with numbers).`,
  });
  const fixes = rv.ok && rv.data && !rv.data.ok ? (rv.data.fixes ?? []).filter((f) => typeof f === "string" && f.trim()) : [];
  emit({ step: "review", ok: fixes.length === 0, detail: fixes.join("; ") || (rv.ok ? undefined : rv.error) });
  if (fixes.length) {
    // one more builder round; keep the checked version if the revision breaks a check
    emit({ step: "revise", attempt: attempts + 1 });
    const got = await ask("sonnet", "repair", repairPrompt(code, "(none: the code passes the automatic checks)", `\nA reviewer who read the measurements asks for these changes:\n${fixes.map((f) => `- ${f}`).join("\n")}\n`));
    if (!("error" in got)) {
      const k = judge(got.code);
      emit({ step: "revise", attempt: attempts, ok: k.failures === null, detail: k.failures ?? undefined });
      if (k.failures === null && k.measured && k.group) { code = got.code; j = k; author = "sonnet"; }
    }
  }

  // 5. store, with measured numbers
  const measured = j.measured!;
  const result: PropResult = { ok: true, id: req.id, code, checks: j.checks, measured, attempts };
  if (o.save !== false) {
    try {
      result.meta = saveProp({ id: req.id, code, description: req.description, placement, measured, by: model(author) }, dir);
      emit({ step: "saved", ok: true, detail: `${req.id} (${measured.size.map(cm).join(" x ")})` });
    } catch (e) { return { ...result, ok: false, error: (e as Error).message }; }
  }
  return result;
}
