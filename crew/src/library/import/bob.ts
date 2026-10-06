// Import "The Bob" previs: sculpted characters (BOB1 binaries), looks, poses,
// voices with lip-sync tracks, soundtrack, timelines.
//
// Characters are rebuilt exactly the way the film built them at runtime
// (18-bone previs rig, A-pose bind, physical materials, Mii-style face), then
// exported as standard skinned glTF. Materials are named by slot so any of the
// film's 14 looks can be applied to the matching body.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { THREE, exportGLB } from "../node-three.ts";

export const BOB_BONES = ["root", "hips", "spine", "chest", "neck", "head", "lSh", "lEl", "lHand", "rSh", "rEl", "rHand", "lHip", "lKnee", "lAnk", "rHip", "rKnee", "rAnk"];
export const MATERIAL_SLOTS = ["skin", "top", "bottom", "shoe", "accent", "hair", "lips", "tie"];
const D2R = Math.PI / 180;

/** Which sculpted body each of the film's looks wears. */
export const LOOK_BODY: Record<string, string> = {
  dowie: "dowie", baden: "baden", bob: "bob", cofer: "cofer", teacher: "teacher", anna: "anna",
  orla: "witch", anabela: "witch", saba: "witch", adultD: "dowie", adultB: "baden", stuA: "dowie", stuB: "baden", stuC: "bob",
};

export interface Look {
  skin: string; top: string; bottom: string; shoe: string; hair: string; brow?: string; lips: string;
  accent?: string; tie?: string; topSheen?: string; bottomSheen?: string; hairSheen?: string; shoeCoat?: number; shoeRough?: number;
  iris?: [string, string]; scale?: number;
}

interface MeshMeta { name: string; vcount: number; icount: number; groups: { start: number; count: number; mat: number }[]; double?: boolean; off: number[]; geo?: THREE.BufferGeometry }
interface Meta { char: string; bones: string[]; armA: number; legA: number; meshes: MeshMeta[]; mii?: { c: number[]; r: number[] } }

// ---------------------------------------------------------------- BOB1 parsing (port of CAST.parse)

export function parseBob1(buf: Buffer): Meta {
  if (buf.toString("ascii", 0, 4) !== "BOB1") throw new Error("not a BOB1 mesh");
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const hl = buf.readUInt32LE(4);
  const meta = JSON.parse(buf.toString("utf8", 8, 8 + hl)) as Meta;
  const base = 8 + hl;
  for (const m of meta.meshes) {
    const o = m.off.map((x) => x + base);
    const g = new THREE.BufferGeometry();
    const pi = new Int16Array(ab, o[0], m.vcount * 3);
    const pf = new Float32Array(pi.length);
    for (let i = 0; i < pi.length; i++) pf[i] = pi[i] * 1e-4;
    g.setAttribute("position", new THREE.BufferAttribute(pf, 3));
    const nq = new Int8Array(ab, o[1], m.vcount * 4);
    const nf = new Float32Array(m.vcount * 3);
    for (let i = 0; i < m.vcount; i++) {
      const x = nq[i * 4] / 127, y = nq[i * 4 + 1] / 127, z = nq[i * 4 + 2] / 127;
      const l = Math.hypot(x, y, z) || 1;
      nf[i * 3] = x / l; nf[i * 3 + 1] = y / l; nf[i * 3 + 2] = z / l;
    }
    g.setAttribute("normal", new THREE.BufferAttribute(nf, 3));
    g.setAttribute("skinIndex", new THREE.BufferAttribute(new Uint8Array(ab.slice(o[2], o[2] + m.vcount * 4)), 4));
    g.setAttribute("skinWeight", new THREE.BufferAttribute(new Uint8Array(ab.slice(o[3], o[3] + m.vcount * 4)), 4, true));
    const idx32 = new Uint32Array(ab.slice(o[4], o[4] + m.icount * 4));
    g.setIndex(new THREE.BufferAttribute(m.vcount < 65536 ? Uint16Array.from(idx32) : idx32, 1));
    for (const gr of m.groups) g.addGroup(gr.start, gr.count, gr.mat);
    m.geo = g;
  }
  return meta;
}

// ---------------------------------------------------------------- materials (port of CAST materials())

const C = (h: string) => new THREE.Color(h);

export function lookMaterials(o: Look): THREE.Material[] {
  const named = <T extends THREE.Material>(m: T, n: string) => { m.name = n; return m; };
  const skin = named(new THREE.MeshPhysicalMaterial({ color: C(o.skin), roughness: 0.55, clearcoat: 0.18, clearcoatRoughness: 0.45, sheen: 0.35, sheenRoughness: 0.5, sheenColor: C("#ff9a7a").multiplyScalar(0.3), specularIntensity: 0.4 }), "skin");
  const cloth = (h: string, sh: string | undefined, r = 0.92, n = "") => named(new THREE.MeshPhysicalMaterial({ color: C(h), roughness: r, sheen: 1, sheenRoughness: 0.55, sheenColor: C(sh || "#ffffff").multiplyScalar(0.3) }), n);
  return [
    skin,
    cloth(o.top, o.topSheen, 0.92, "top"),
    cloth(o.bottom, o.bottomSheen, 0.92, "bottom"),
    named(new THREE.MeshPhysicalMaterial({ color: C(o.shoe), roughness: o.shoeRough || 0.55, clearcoat: o.shoeCoat || 0 }), "shoe"),
    cloth(o.accent || "#ffffff", "#ffffff", 0.8, "accent"),
    named(new THREE.MeshPhysicalMaterial({ color: C(o.hair), roughness: 0.42, sheen: 1, sheenRoughness: 0.3, sheenColor: C(o.hairSheen || "#a07a5a").multiplyScalar(0.5), specularIntensity: 0.7 }), "hair"),
    named(new THREE.MeshPhysicalMaterial({ color: C(o.lips), roughness: 0.35, clearcoat: 0.3, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: C("#ff9a8a").multiplyScalar(0.3) }), "lips"),
    cloth(o.tie || "#6b1a22", "#ffb0b0", 0.6, "tie"),
  ];
}

// ---------------------------------------------------------------- character build (port of CAST.build)

export function buildBobCharacter(meta: Meta, o: Look, lookName: string): THREE.Group {
  const mats = lookMaterials(o);
  const root = new THREE.Group();
  root.name = `${meta.char}`;
  const B: Record<string, THREE.Bone> = {};
  const mk = (name: string, parent: THREE.Object3D, x: number, y: number, z: number) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); B[name] = b; return b; };
  const rb = mk("root", root, 0, 0, 0);
  const hips = mk("hips", rb, 0, 0.975, 0), spine = mk("spine", hips, 0, 0.05, 0), chest = mk("chest", spine, 0, 0.22, 0), neck = mk("neck", chest, 0, 0.28, 0);
  const head = mk("head", neck, 0, 0.085, 0);
  for (const [s, k] of [[1, "l"], [-1, "r"]] as const) {
    const sh = mk(k + "Sh", chest, 0.182 * s, 0.212, -0.01); const el = mk(k + "El", sh, 0, -0.3, 0); mk(k + "Hand", el, 0, -0.265, 0);
    const hp = mk(k + "Hip", hips, 0.092 * s, -0.03, 0); const kn = mk(k + "Knee", hp, 0, -0.45, 0); mk(k + "Ank", kn, 0, -0.43, 0);
  }
  B.lSh.rotation.z = meta.armA * D2R; B.rSh.rotation.z = -meta.armA * D2R; B.lHip.rotation.z = meta.legA * D2R; B.rHip.rotation.z = -meta.legA * D2R;
  root.updateMatrixWorld(true);
  const skel = new THREE.Skeleton(meta.bones.map((n) => B[n]));
  for (const m of meta.meshes) {
    let mm: THREE.Material[] = m.name === "hair" ? mats.map(() => mats[5]) : mats;
    if (m.double) mm = mm.map((x) => { const c = x.clone(); c.side = THREE.DoubleSide; return c; });
    const mesh = new THREE.SkinnedMesh(m.geo!, mm);
    mesh.name = m.name;
    root.add(mesh);
    mesh.bind(skel);
  }
  if (meta.mii) addMiiFace(meta, o, head);
  root.scale.setScalar(o.scale || 1);
  root.userData = {
    crew: {
      rig: "bob18", bones: BOB_BONES, bindPose: { armA: meta.armA, legA: meta.legA }, look: lookName, scale: o.scale || 1,
      materialSlots: MATERIAL_SLOTS, face: ["eye_L", "eye_R", "eyeHighlight_L", "eyeHighlight_R", "brow_L", "brow_R", "mouth", "mouthOpen"],
      height: 1.865 * (o.scale || 1),
    },
  };
  return root;
}

function addMiiFace(meta: Meta, o: Look, head: THREE.Bone) {
  const c = meta.mii!.c, rr = meta.mii!.r, hb = 1.61;
  const surfA = (x: number, y: number) => Math.max(c[2] + rr[2] * Math.sqrt(Math.max(0, 1 - (x / rr[0]) ** 2 - ((y - c[1]) / rr[1]) ** 2)), 0.015 + 0.103 * Math.sqrt(Math.max(0, 1 - (x / 0.11) ** 2 - ((y - 1.632) / 0.085) ** 2)));
  const hm = meta.meshes.find((m) => m.name === "head");
  const tmpM = hm ? new THREE.Mesh(hm.geo!, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })) : null;
  const rcx = new THREE.Raycaster();
  const surf = (x: number, y: number) => {
    if (!tmpM) return surfA(x, y);
    rcx.set(new THREE.Vector3(x, y, 0.6), new THREE.Vector3(0, 0, -1));
    const h = rcx.intersectObject(tmpM, false);
    return h.length ? h[0].point.z : surfA(x, y);
  };
  const surfMax = (xs: number[], ys: number[]) => { let z = -1; for (const x of xs) for (const y of ys) z = Math.max(z, surf(x, y)); return z; };
  const eyeM = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.01, 0.009, 0.009), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.04 }); eyeM.name = "eye";
  const hiM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1) }); hiM.name = "eyeHighlight";
  const browM = new THREE.MeshStandardMaterial({ color: C(o.brow || "#2a1d16"), roughness: 0.6 }); browM.name = "brow";
  const mouthM = new THREE.MeshStandardMaterial({ color: C("#6e2f2a"), roughness: 0.5 }); mouthM.name = "mouth";
  for (const s of [1, -1]) {
    const side = s > 0 ? "L" : "R";
    const x = 0.04 * s, y = 1.69, z = surf(x, y);
    const e = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), eyeM); e.name = `eye_${side}`;
    e.scale.set(0.0105, 0.0172, 0.006); e.position.set(x, y - hb, z - 0.0012); e.rotation.y = Math.atan2(x, z - c[2]); head.add(e);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.0027, 10, 8), hiM); h.name = `eyeHighlight_${side}`;
    h.position.set(x + 0.0035, y - hb + 0.0065, z + 0.0035); head.add(h);
    const bx = 0.043 * s, by = 1.726, bz = surf(bx, by);
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.0034, 0.022, 4, 10), browM); b.name = `brow_${side}`;
    b.position.set(bx, by - hb, bz + 0.0005); b.rotation.set(0, Math.atan2(bx, bz - c[2]), Math.PI / 2 + 0.12 * s); head.add(b);
  }
  const mg = new THREE.TorusGeometry(0.019, 0.0032, 8, 28, 2.1); mg.rotateZ(-Math.PI / 2 - 1.05); mg.translate(0, 0.019, 0);
  const m = new THREE.Mesh(mg, mouthM); m.name = "mouth";
  const my = 1.626;
  m.position.set(0, my - hb, surfMax([-0.016, -0.008, 0, 0.008, 0.016], [my, my + 0.006, my + 0.012]) + 0.0035); head.add(m);
  const opM = new THREE.MeshStandardMaterial({ color: C("#3a1210"), roughness: 0.6 }); opM.name = "mouthOpen";
  const op = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), opM); op.name = "mouthOpen";
  op.position.set(0, my + 0.006 - hb, surfMax([-0.008, 0, 0.008], [my + 0.002, my + 0.008]) + 0.0005);
  op.scale.set(0.0085, 0.0012, 0.004); op.userData = { hidden: true, note: "scale y by 0.0012 + 0.0125*open to open the mouth" };
  head.add(op);
}

// ---------------------------------------------------------------- data extraction from the master HTML

/** Pull a top-level `const NAME={...};` object literal out of the film source and evaluate it as data. */
export function extractObjectLiteral(src: string, name: string): unknown {
  const at = src.indexOf(`const ${name}={`);
  if (at < 0) throw new Error(`const ${name} not found`);
  let i = src.indexOf("{", at), depth = 0, inStr: string | null = null;
  const start = i;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (inStr) { if (ch === "\\") { i++; continue; } if (ch === inStr) inStr = null; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { inStr = ch; continue; }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") { depth--; if (depth === 0) break; }
  }
  // It's the user's own film source and only an object literal of numbers/strings/arrays.
  return new Function(`return (${src.slice(start, i + 1)});`)();
}

export function parseLinesPy(src: string) {
  const voices: Record<string, [string, string, number]> = {};
  for (const m of src.matchAll(/^(\w+) = \('(\w+)', '(\w+)', ([\d.]+)\)/gm)) voices[m[1]] = [m[2], m[3], Number(m[4])];
  const lines: { id: string; who: string; voice: string; speed: number; text: string; tts: string }[] = [];
  const str = String.raw`"((?:[^"\\]|\\.)*)"`;
  const re = new RegExp(String.raw`L\('(\w+)', (\w+|\('\w+','\w+',[\d.]+\)), ${str}(?:, tts=${str})?(?:, speed=([\d.]+))?\)`, "g");
  for (const m of src.matchAll(re)) {
    let who: [string, string, number];
    const tuple = m[2].match(/\('(\w+)','(\w+)',([\d.]+)\)/);
    if (tuple) who = [tuple[1], tuple[2], Number(tuple[3])];
    else who = voices[m[2]];
    if (!who) continue;
    const text = JSON.parse(`"${m[3]}"`) as string;
    lines.push({ id: m[1], who: who[0], voice: who[1], speed: m[5] ? Number(m[5]) : who[2], text, tts: m[4] ? JSON.parse(`"${m[4]}"`) : text });
  }
  return lines;
}

/** Duration of a PCM/float WAV file in seconds, from its header. */
export function wavInfo(buf: Buffer) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let p = 12, sampleRate = 0, channels = 0, bits = 0, dataBytes = 0;
  while (p + 8 <= buf.length) {
    const id = buf.toString("ascii", p, p + 4), size = buf.readUInt32LE(p + 4);
    if (id === "fmt ") { channels = buf.readUInt16LE(p + 10); sampleRate = buf.readUInt32LE(p + 12); bits = buf.readUInt16LE(p + 22); }
    if (id === "data") { dataBytes = size; break; }
    p += 8 + size + (size % 2);
  }
  const duration = dataBytes / (sampleRate * channels * (bits / 8));
  return { sampleRate, channels, bits, duration: Math.round(duration * 1000) / 1000 };
}

// ---------------------------------------------------------------- import

export interface ImportLog { wrote: string[]; notes: string[] }

export async function importTheBob(root: string, lib: string, log: ImportLog = { wrote: [], notes: [] }): Promise<ImportLog> {
  const code = join(root, "code"), assets = join(root, "assets");
  const master = readFileSync(join(code, "src", "index_master.html"), "utf8");
  const looks = extractObjectLiteral(master, "LOOK") as Record<string, Look>;
  const poses = extractObjectLiteral(master, "P") as Record<string, Record<string, number[] | number>>;
  const w = (p: string, data: string | Buffer) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, data); log.wrote.push(p); };

  // looks + poses
  w(join(lib, "looks", "the_bob.json"), JSON.stringify({ source: "The Bob previs", bodies: LOOK_BODY, looks }, null, 2));
  w(join(lib, "poses", "the_bob.json"), JSON.stringify({
    source: "The Bob previs", rig: "bob18",
    joints: ["hips", "spine", "chest", "neck", "head", "lSh", "lEl", "lHand", "rSh", "rEl", "rHand", "lHip", "lKnee", "lAnk", "rHip", "rKnee", "rAnk"],
    units: "Euler XYZ degrees per joint, relative to the A-pose bind; `lift` is a root height offset in metres",
    poses,
  }, null, 2));

  // characters
  const charDir = join(assets, "characters");
  for (const f of readdirSync(charDir).filter((x) => x.endsWith(".mesh.wasm"))) {
    const id = basename(f, ".mesh.wasm");
    const buf = readFileSync(join(charDir, f));
    const meta = parseBob1(buf);
    const look = looks[id] ?? Object.values(looks)[0];
    const obj = buildBobCharacter(meta, look, id);
    const out = join(lib, "characters", `bob_${id}`);
    mkdirSync(out, { recursive: true });
    w(join(out, `${id}.glb`), await exportGLB(obj));
    copyFileSync(join(charDir, f), join(out, `${id}.bob1`));
    log.wrote.push(join(out, `${id}.bob1`));
    const tris = meta.meshes.reduce((a, m) => a + m.icount / 3, 0), verts = meta.meshes.reduce((a, m) => a + m.vcount, 0);
    w(join(out, "asset.json"), JSON.stringify({
      id: `bob_${id}`, kind: "character", title: `${id[0].toUpperCase()}${id.slice(1)} (The Bob)`,
      tags: ["the-bob", "sculpted", "skinned", "stylised", "previs"],
      source: { project: "The Bob", file: `assets/characters/${f}`, pipeline: "code/pipeline/characters/people.py (SDF sculpt, marching cubes, auto-skin)" },
      files: { model: `${id}.glb`, source: `${id}.bob1` },
      meta: { rig: "bob18", bones: BOB_BONES, meshes: meta.meshes.map((m) => m.name), verts, tris, defaultLook: id, looks: Object.entries(LOOK_BODY).filter(([, b]) => b === id).map(([l]) => l), materialSlots: MATERIAL_SLOTS, height: 1.865 * (look.scale ?? 1) },
    }, null, 2));
  }

  // voices + lips + lines
  const lines = parseLinesPy(readFileSync(join(code, "pipeline", "voices", "lines.py"), "utf8"));
  const aliasLines = existsSync(join(code, "pipeline", "voices", "lines_alias.py")) ? parseLinesPy(readFileSync(join(code, "pipeline", "voices", "lines_alias.py"), "utf8")) : [];
  for (const variant of ["real", "alias"]) {
    const vdir = join(assets, "voices", variant);
    if (!existsSync(vdir)) continue;
    const lips = JSON.parse(readFileSync(join(code, "data", variant, "lips.json"), "utf8")) as Record<string, string>;
    const timeline = JSON.parse(readFileSync(join(code, "data", variant, "timeline.json"), "utf8"));
    const out = join(lib, "voices", `the_bob_${variant}`);
    const ls = variant === "alias" && aliasLines.length ? aliasLines : lines;
    const clips = [];
    for (const f of readdirSync(vdir).filter((x) => x.endsWith(".wav")).sort()) {
      const id = basename(f, ".wav");
      mkdirSync(out, { recursive: true });
      copyFileSync(join(vdir, f), join(out, f));
      log.wrote.push(join(out, f));
      const info = wavInfo(readFileSync(join(vdir, f)));
      const line = ls.find((l) => l.id === id) ?? (id.startsWith("vo_") ? { id, who: "narrator", voice: "", speed: 1, text: "", tts: "" } : null);
      clips.push({ id, file: f, ...info, who: line?.who ?? null, text: line?.text ?? null, ttsVoice: line?.voice ?? null, speed: line?.speed ?? null, lips: lips[id] ?? null });
    }
    w(join(out, "clips.json"), JSON.stringify({
      source: `The Bob previs (${variant} names)`, tts: "Kokoro (Apache-2.0), blended voices via pipeline/voices/humanvo.py",
      lipsFormat: "base64 bytes, 4 channels per frame at 30 fps: open, wide, round, emphasis (0-255)",
      clips,
    }, null, 2));
    w(join(out, "timeline.json"), JSON.stringify(timeline, null, 2));
    w(join(out, "asset.json"), JSON.stringify({
      id: `the_bob_${variant}`, kind: "voicepack", title: `The Bob dialogue (${variant} names)`, tags: ["the-bob", "dialogue", "lip-sync", "kokoro"],
      source: { project: "The Bob", file: `assets/voices/${variant}` }, files: { clips: "clips.json", timeline: "timeline.json" },
      meta: { count: clips.length, speakers: [...new Set(clips.map((c) => c.who).filter(Boolean))], seconds: Math.round(clips.reduce((a, c) => a + c.duration, 0) * 10) / 10 },
    }, null, 2));
  }

  // soundtrack
  for (const variant of ["real", "alias"]) {
    const f = join(assets, "soundtrack", `soundtrack_${variant}.mp3`);
    if (!existsSync(f)) continue;
    const out = join(lib, "music", `the_bob_score_${variant}`);
    mkdirSync(out, { recursive: true });
    copyFileSync(f, join(out, "score.mp3"));
    log.wrote.push(join(out, "score.mp3"));
    const timeline = JSON.parse(readFileSync(join(code, "data", variant, "timeline.json"), "utf8")) as { end: number; marks: Record<string, number> };
    w(join(out, "asset.json"), JSON.stringify({
      id: `the_bob_score_${variant}`, kind: "music", title: `The Bob full mix (${variant} names)`, tags: ["the-bob", "score", "full-mix", "temp"],
      source: { project: "The Bob", file: `assets/soundtrack/soundtrack_${variant}.mp3`, pipeline: "code/pipeline/audio/mix_full.py" },
      files: { audio: "score.mp3" },
      meta: { bytes: statSync(f).size, seconds: timeline.end, markers: timeline.marks, note: "original temp material standing in for licensed songs" },
    }, null, 2));
  }

  // the film's shot data and pipeline code, kept as reference source
  const ref = join(lib, "reference", "the_bob");
  mkdirSync(ref, { recursive: true });
  for (const [from, to] of [["src/index_master.html", "index_master.html"], ["tools/qa/audit.js", "qa_audit.js"], ["pipeline/timing_lipsync/lipsync.py", "lipsync.py"], ["pipeline/timing_lipsync/timeline.py", "timeline.py"], ["pipeline/voices/humanvo.py", "humanvo.py"], ["pipeline/characters/people.py", "people.py"], ["pipeline/characters/mii.py", "mii.py"], ["pipeline/audio/mix_full.py", "mix_full.py"], ["README.md", "README.md"]]) {
    if (existsSync(join(code, from))) { copyFileSync(join(code, from), join(ref, to)); log.wrote.push(join(ref, to)); }
  }
  log.notes.push(`The Bob: ${readdirSync(charDir).filter((x) => x.endsWith(".mesh.wasm")).length} characters, ${Object.keys(looks).length} looks, ${Object.keys(poses).length} poses, ${lines.length} lines`);
  return log;
}
