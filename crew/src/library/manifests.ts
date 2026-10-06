// asset.json for library items that aren't produced by an importer (or whose
// importer predates the catalog). Safe to re-run: existing manifests are kept
// unless `force` is set.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { glbJson } from "./node-three.ts";
import { PROP_META } from "../../library/props/meta.js";
import { librarySets, parseShow } from "../scene/parse.ts";

const write = (p: string, j: unknown, force: boolean) => { if (force || !existsSync(p)) writeFileSync(p, JSON.stringify(j, null, 2)); };

/** Exported names of a generated kit (declared by the port as `export const EXPORTS = [...]`). */
function kitExports(file: string): string[] {
  const m = readFileSync(file, "utf8").match(/export const EXPORTS = (\[[^\n]*\]);/);
  return m ? (JSON.parse(m[1]) as string[]) : [];
}

export function writeManifests(lib: string, force = false) {
  // MakeHuman humans
  for (const sex of ["male", "female"]) {
    const dir = join(lib, "characters", `makehuman_${sex}`);
    const f = join(dir, `human_${sex}.glb`);
    if (!existsSync(f)) continue;
    const j = glbJson(readFileSync(f)) as { meshes?: unknown[]; skins?: { joints: number[] }[]; materials?: unknown[]; images?: unknown[] };
    write(join(dir, "asset.json"), {
      id: `makehuman_${sex}`, kind: "character", title: `Human ${sex} (MakeHuman rig)`, tags: ["human", "realistic", "skinned", "makehuman", sex],
      source: { project: "Crew", file: `human_${sex}.glb` }, files: { model: `human_${sex}.glb`, rig: "../../rigs/makehuman.json" },
      meta: { rig: "makehuman163", joints: j.skins?.[0]?.joints.length ?? 0, meshes: j.meshes?.length ?? 0, materials: j.materials?.length ?? 0, textures: j.images?.length ?? 0, facialBones: true, animations: 0, height: sex === "male" ? 1.75 : 1.61 },
    }, force);
  }
  write(join(lib, "rigs", "asset.json"), {
    id: "rig_makehuman", kind: "rig", title: "MakeHuman 163-joint rig map", tags: ["rig", "makehuman", "retarget"],
    files: { map: "makehuman.json" }, meta: { channels: "hips, spine, chest, neck, head, jaw, eyes, lids, brows, mouth corners, arms, legs" },
  }, force);
  if (existsSync(join(lib, "looks", "the_bob.json"))) {
    const j = JSON.parse(readFileSync(join(lib, "looks", "the_bob.json"), "utf8")) as { looks: Record<string, unknown>; bodies: Record<string, string> };
    write(join(lib, "looks", "asset.json"), {
      id: "looks_the_bob", kind: "looks", title: "The Bob: 14 character looks", tags: ["the-bob", "palette", "wardrobe", "looks"],
      source: { project: "The Bob", file: "index_master.html (LOOK)" }, files: { looks: "the_bob.json" },
      meta: { looks: Object.keys(j.looks), bodies: j.bodies, slots: ["skin", "top", "bottom", "shoe", "accent", "hair", "lips", "tie", "brow", "iris"] },
    }, force);
  }
  if (existsSync(join(lib, "poses", "the_bob.json"))) {
    const j = JSON.parse(readFileSync(join(lib, "poses", "the_bob.json"), "utf8")) as { poses: Record<string, unknown> };
    write(join(lib, "poses", "asset.json"), {
      id: "poses_the_bob", kind: "poses", title: "The Bob: pose library", tags: ["the-bob", "poses", "keyframes", "bob18"],
      source: { project: "The Bob", file: "index_master.html (P)" }, files: { poses: "the_bob.json" },
      meta: { rig: "bob18", poses: Object.keys(j.poses), scene: "kiran pose <name> ~N (names in snake_case, e.g. catch_high)" },
    }, force);
  }
  // Odyssey shaders
  const og = join(lib, "effects", "odyssey_ocean");
  if (existsSync(join(og, "glsl"))) {
    write(join(og, "asset.json"), {
      id: "odyssey_ocean", kind: "effect", title: "Storm ocean raymarcher (Scylla and Charybdis)", tags: ["odyssey", "ocean", "storm", "raymarch", "glsl", "webgl2"],
      source: { project: "Odyssey", file: "Odyssey.html <script type=x-shader>" },
      files: Object.fromEntries(readdirSync(join(og, "glsl")).map((f) => [f.replace(".glsl", ""), `glsl/${f}`])),
      meta: { api: "raw WebGL2, progressive accumulation (probe/resolve), see kits/films/odyssey.js", uniforms: ["uTime", "uCamPos", "uCamRot", "uShipPos", "uShipRot", "uOarPhase", "uFlash", "uBolt[40]", "uFog", "uSpray", "uWhirl", "uScylla"] },
    }, force);
  }
  // film kits
  const kits: Record<string, { title: string; tags: string[]; project: string; factory: string; needs: string[] }> = {
    the_bob: { title: "The Bob: the whole previs as a kit", tags: ["the-bob", "film", "sets", "cast", "framing", "performance", "kilimanjaro"], project: "The Bob", factory: "createTheBob", needs: ["characters/bob_*/*.bob1", "music/the_bob_score_real/score.mp3"] },
    low_pass: { title: "Low Pass: London, the Thames, an F-16 and a B-2", tags: ["low-pass", "film", "london", "thames", "aircraft", "traffic", "crowd", "hdr"], project: "Low Pass", factory: "createLowPass", needs: ["data/london_osm/buildings.compact.json"] },
    odyssey: { title: "Scylla and Charybdis: raymarched storm film", tags: ["odyssey", "film", "ocean", "storm", "webgl2"], project: "Odyssey", factory: "createOdyssey", needs: ["music/odyssey_score/score.m4a"] },
  };
  const filmsDir = join(lib, "kits", "films");
  if (existsSync(filmsDir)) {
    // kits share a folder, so each gets its manifest in kits/_manifests/<id>/
    for (const [id, k] of Object.entries(kits)) {
      const f = join(filmsDir, `${id}.js`);
      if (!existsSync(f)) continue;
      const mdir = join(lib, "kits", "_manifests", id);
      mkdirSync(mdir, { recursive: true });
      write(join(mdir, "asset.json"), {
        id: `kit_${id}`, kind: "kit", title: k.title, tags: k.tags, source: { project: k.project, file: `reference/${id === "the_bob" ? "the_bob/index_master.html" : id === "low_pass" ? "low_pass/low-pass.js" : "odyssey/odyssey.js"}` },
        files: { module: `../../films/${id}.js`, compat: "../../compat.js" },
        meta: { factory: k.factory, exports: kitExports(f), needs: k.needs, bytes: statSync(f).size, generatedBy: "crew library port" },
      }, true);
    }
  }
  // props: one manifest per prop in props/_manifests/<id>/ (the builders live in four modules)
  for (const m of Object.values(PROP_META)) {
    const mdir = join(lib, "props", "_manifests", m.id);
    mkdirSync(mdir, { recursive: true });
    const tags = ["prop", m.category, m.placement, m.source.toLowerCase().replace(/\s+/g, "-")];
    for (const f of ["sittable", "decor", "animated", "openable", "light"] as const) if (m[f]) tags.push(f);
    write(join(mdir, "asset.json"), {
      id: `prop_${m.id}`, kind: "prop", title: m.title, tags,
      source: { project: m.source === "new" ? "Crew" : m.source },
      files: { module: m.module === "generated" ? `../../generated/${m.id}.js` : `../../${m.module}.js`, registry: "../../index.js" },
      meta: { prop: m.id, category: m.category, placement: m.placement, size: m.size, y0: m.y0, sittable: !!m.sittable, sitHeight: m.sitHeight ?? null, surface: m.surface ?? null, decor: !!m.decor, animated: !!m.animated, openable: !!m.openable, build: `PROPS.${m.id}.build(opts)`, scene: `anchor <id> at x z face d is ${m.id}   |   dress ${m.id} at x z [face d] [on <anchor>|height h] [scale s]` },
    }, true);
  }
  // sets: one manifest per library/sets/<name>.scene in sets/_manifests/<name>/
  for (const name of librarySets()) {
    const s = parseShow(`include ${name}`).sets[name];
    if (!s) continue;
    const mdir = join(lib, "sets", "_manifests", name);
    mkdirSync(mdir, { recursive: true });
    const src = readFileSync(join(lib, "sets", `${name}.scene`), "utf8");
    const origin = src.match(/^# \[([^\]]+)\]/)?.[1] ?? "Crew";
    write(join(mdir, "asset.json"), {
      id: `set_${name}`, kind: "set", title: name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), tags: ["set", "scene", s.open ? "exterior" : "interior", origin.toLowerCase().replace(/\s+/g, "-")],
      source: { project: origin },
      files: { scene: `../../${name}.scene` },
      meta: { set: name, size: [s.w, s.d], open: !!s.open, entrance: s.entrance, anchors: Object.values(s.anchors).map((a) => ({ id: a.id, at: [a.x, a.z], face: a.face, is: a.furniture })), dress: s.dress.map((d) => d.kind), props: Object.values(s.props).map((p) => p.id), use: `include ${name}   (in show.scene; later anchor/prop/dress lines extend it)` },
    }, true);
  }
  // reference sources
  for (const [id, title] of [["the_bob", "The Bob: original source and pipeline"], ["low_pass", "Low Pass: original source"], ["odyssey", "Odyssey: original source"]] as const) {
    const dir = join(lib, "reference", id);
    if (!existsSync(dir)) continue;
    write(join(dir, "asset.json"), {
      id: `reference_${id}`, kind: "reference", title, tags: ["source", "reference", id.replace("_", "-")],
      files: Object.fromEntries(readdirSync(dir).filter((f) => f !== "asset.json").map((f) => [f.replace(/\W+/g, "_"), f])),
      meta: { note: "verbatim originals; the kits and importers are generated from these" },
    }, force);
  }
}
