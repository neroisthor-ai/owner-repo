// Scores a model-written prop builder (the kettle case): runs it in a sandbox with three.js and the prop helpers only,
// measures it against the spec, and optionally renders four views. Usage:
//   npx tsx scripts/prop-exam.ts pro-exam/prop-kettle.reply.txt [--preview out.png]
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as THREE from "three";
import { box, cyl, finish, group, mat, mesh, merged, mergeGeometries, TM } from "../library/props/core.js";

const file = process.argv[2] ?? "pro-exam/prop-kettle.reply.txt";
const raw = readFileSync(file, "utf8");
const code = (raw.match(/```(?:js|javascript)?\n([\s\S]*?)```/)?.[1] ?? raw).replace(/^\s*import[^\n]*\n/gm, "").replace(/export\s+function/g, "function");

const checks: { name: string; pass: boolean; detail?: string }[] = [];
const ck = (name: string, pass: boolean, detail?: string) => checks.push({ name, pass, detail });

let g: THREE.Object3D | null = null;
try {
  const ctx = vm.createContext({ THREE, box, cyl, finish, group, mat, mesh, merged, mergeGeometries, TM, Math, console: { log() {} } });
  vm.runInContext(`${code}\n;globalThis.__out = stovetop_kettle({});`, ctx, { timeout: 2000 });
  g = (ctx as { __out?: THREE.Object3D }).__out ?? null;
  ck("the code runs and returns a group", !!g && (g as THREE.Group).isGroup === true);
} catch (e) { ck("the code runs and returns a group", false, (e as Error).message); }

if (g) {
  g.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(g), size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
  const near = (v: number, want: number, tol = 0.1) => Math.abs(v - want) <= want * tol;
  ck("width about 26 cm (incl. spout)", near(size.x, 0.26), `${(size.x * 100).toFixed(1)} cm`);
  ck("height about 24 cm (to the handle)", near(size.y, 0.24), `${(size.y * 100).toFixed(1)} cm`);
  ck("depth about 19 cm", near(size.z, 0.19), `${(size.z * 100).toFixed(1)} cm`);
  ck("stands exactly on the ground", Math.abs(bb.min.y) <= 0.003, `lowest point ${(bb.min.y * 100).toFixed(2)} cm`);
  ck("centred on x and z", Math.abs(c.x) <= 0.01 && Math.abs(c.z) <= 0.01, `centre x ${(c.x * 100).toFixed(1)} cm, z ${(c.z * 100).toFixed(1)} cm`);

  const meshes: THREE.Mesh[] = [];
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  let tris = 0, nan = false;
  const mats = new Set<THREE.Material>();
  for (const m of meshes) {
    const geo = m.geometry, pos = geo.attributes.position;
    tris += (geo.index ? geo.index.count : pos.count) / 3;
    for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) { nan = true; break; }
    for (const x of ([] as THREE.Material[]).concat(m.material)) mats.add(x);
  }
  ck("no broken geometry", !nan && meshes.length > 0, `${meshes.length} meshes`);
  ck("at most 8,000 triangles", tris <= 8000, `${Math.round(tris)}`);
  ck("at most 6 materials", mats.size <= 6, `${mats.size}`);
  const parts = meshes.map((m) => ({ m, b: new THREE.Box3().setFromObject(m), col: (m.material as THREE.MeshStandardMaterial).color?.getHexString?.() ?? "" }));
  const dark = (h: string) => parseInt(h.slice(0, 2), 16) + parseInt(h.slice(2, 4), 16) + parseInt(h.slice(4, 6), 16) < 150;
  ck("spout on the right (+x), tip near 16 cm up", parts.some((p) => p.b.max.x >= bb.max.x - 0.005 && p.b.max.y >= 0.13 && p.b.max.y <= 0.2), parts.map((p) => `${p.col} x<=${(p.b.max.x * 100).toFixed(0)} y<=${(p.b.max.y * 100).toFixed(0)}`).join(", "));
  const handle = parts.filter((p) => dark(p.col) && p.b.max.y >= bb.max.y - 0.005);
  ck("black handle is the top, arching front to back", handle.length > 0 && (() => { const hb = new THREE.Box3(); handle.forEach((p) => hb.union(p.b)); return hb.max.z - hb.min.z >= 0.1 && hb.max.z - hb.min.z > hb.max.x - hb.min.x; })(), `${handle.length} dark part(s) reach the top`);
  ck("body in the given colour", parts.some((p) => p.col === "b83a2e"));
  const ud = (g as THREE.Group).userData?.prop;
  ck("labelled stovetop_kettle, onSurface", ud?.id === "stovetop_kettle" && ud?.onSurface === true);
}

const pass = checks.filter((c) => c.pass).length;
for (const c of checks) console.log(`  ${c.pass ? "✓" : "✗"} ${c.name}${c.detail ? `  [${c.detail}]` : ""}`);
console.log(`\nprop-kettle: ${pass}/${checks.length}`);

// four views, rendered in a real browser with the same three.js the film uses
const pi = process.argv.indexOf("--preview");
if (pi > 0 && g) {
  const { createRequire } = await import("node:module");
  const { chromium } = createRequire(process.env.PW_NODE ?? "/opt/node-tools/")("playwright");
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await b.newPage({ viewport: { width: 1200, height: 340 } });
  const base = process.env.CREW_URL ?? "http://localhost:4310";
  await page.goto(`${base}/vendor/three/three.module.js`); // same origin as the modules, so they may load
  await page.setContent(`<html><body style="margin:0;background:#1e1e20"><canvas id="c" width="1200" height="340"></canvas>
<script type="importmap">{"imports":{"three":"${base}/vendor/three/three.module.js"}}</script>
<script type="module">
import * as THREE from "three";
import { box, cyl, finish, group, mat, mesh, merged, mergeGeometries, TM } from "${base}/library/props/core.js";
${code}
const r = new THREE.WebGLRenderer({ canvas: document.getElementById("c"), antialias: true }); r.setScissorTest(true);
const s = new THREE.Scene(); s.background = new THREE.Color("#2a2a2e");
s.add(new THREE.HemisphereLight("#ffffff", "#444444", 2.2)); const d = new THREE.DirectionalLight("#ffffff", 2.5); d.position.set(1, 2, 1.5); s.add(d);
s.add(stovetop_kettle({}));
const grid = new THREE.GridHelper(0.6, 12, "#555", "#3a3a3a"); s.add(grid);
[["front", 0, 0.12, 0.7], ["right", 0.7, 0.12, 0], ["back three-quarter", -0.5, 0.35, -0.5], ["top", 0, 0.75, 0.001]].forEach(([n, x, y, z], i) => {
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 10); cam.position.set(x, y, z); cam.lookAt(0, 0.11, 0);
  r.setViewport(i * 300, 0, 300, 300); r.setScissor(i * 300, 0, 300, 300); r.render(s, cam);
});
document.title = "done";
</script></body></html>`);
  await page.waitForFunction(() => document.title === "done", null, { timeout: 20000 });
  await page.screenshot({ path: process.argv[pi + 1] });
  await b.close();
  console.log(`preview: ${process.argv[pi + 1]}`);
}
