import { test, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { installCanvasShim, THREE } from "../src/library/node-three.ts";
import { PROP_META } from "../library/props/meta.js";
import { librarySets, parseShow, parseEpisode } from "../src/scene/parse.ts";
import { setGeometry, furnitureSpec, cylinderInto } from "../src/scene/geometry.ts";
import { workspace } from "../src/crew/guard.ts";
import { bake } from "../src/scene/compile.ts";
import { loadCatalog, scanLibrary, sceneVocabulary } from "../src/library/catalog.ts";
import { LIBRARY_DIR } from "../src/project.ts";

let PROPS: Record<string, import("../library/props/index.js").Prop>;
const modules: Record<string, Record<string, unknown>> = {};

before(async () => {
  installCanvasShim();
  const idx = await import("../library/props/index.js");
  PROPS = idx.PROPS;
  for (const m of ["interior", "vehicles", "exterior", "structures"]) modules[m] = await import(`../library/props/${m}.js`);
});

/** Builder exports that are helpers, not props. */
const HELPERS = new Set(["plumeMaterial", "vaporMaterial", "PERSON_POSES", "hipRoof", "kiliH"]);

test("props: the registry and the builders cover each other exactly", () => {
  const exported = Object.entries(modules).flatMap(([m, mod]) => Object.entries(mod).filter(([k, v]) => typeof v === "function" && !HELPERS.has(k)).map(([k]) => `${m}.${k}`));
  const declared = Object.values(PROP_META).map((p) => `${p.module}.${p.id}`);
  assert.deepEqual(exported.sort(), declared.sort());
  assert.ok(declared.length >= 80, `expected a real library, got ${declared.length}`);
});

test("props: every prop builds headlessly, stands where its metadata says and has finite geometry", () => {
  for (const [id, p] of Object.entries(PROPS)) {
    let g: THREE.Group;
    assert.doesNotThrow(() => { g = p.build(); }, `${id} threw`);
    g = p.build();
    assert.ok(g instanceof THREE.Group, `${id} must return a Group`);
    assert.equal(g.name, id, `${id} must be labelled by finish()`);
    let meshes = 0;
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh || (o as THREE.LineSegments).isLineSegments || (o as THREE.Sprite).isSprite) meshes++; });
    assert.ok(meshes > 0, `${id} has no geometry`);
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(new THREE.Vector3());
    for (const v of [...size.toArray(), box.min.x, box.min.y, box.min.z]) assert.ok(Number.isFinite(v), `${id} has NaN geometry`);
    size.toArray().forEach((v, i) => assert.ok(Math.abs(v - p.size[i]) <= Math.max(0.03, p.size[i] * 0.03), `${id} size[${i}] is ${v.toFixed(2)}, declared ${p.size[i]}`));
    assert.ok(Math.abs(box.min.y - p.y0) <= 0.05 + Math.abs(p.y0) * 0.02, `${id} lowest point ${box.min.y.toFixed(2)}, declared ${p.y0}`);
    if (!["aircraft", "sky"].includes(PROP_META[id].category)) assert.ok(box.min.y > -0.15 * Math.max(size.y, 1) - 0.2, `${id} sinks below the floor (${box.min.y.toFixed(2)})`);
    assert.ok(Math.abs((box.min.x + box.max.x) / 2 - p.center[0]) < 0.05 + size.x * 0.02, `${id} centre x moved`);
    // each build is independent: mutating one must not leak into the next
    g.position.set(50, 50, 50);
    const again = new THREE.Box3().setFromObject(p.build()).getSize(new THREE.Vector3());
    assert.ok(Math.abs(again.y - size.y) < 1e-6, `${id} is not deterministic`);
  }
});

test("props: animation and interaction hooks run", () => {
  const P = (id: string, o?: Record<string, unknown>) => PROPS[id].build(o);
  for (const id of Object.values(PROP_META).filter((m) => m.animated).map((m) => m.id)) {
    const g = P(id);
    const u = g.userData as Record<string, (...a: unknown[]) => void>;
    const fn = u.update ?? u.set ?? u.pulse;
    assert.equal(typeof fn, "function", `${id} is marked animated but has no update/set/pulse`);
    assert.doesNotThrow(() => { fn(1.25, { burn: 1, vapor: 0.5 }); fn(7.5); }, `${id} update threw`);
  }
  for (const id of Object.values(PROP_META).filter((m) => m.openable).map((m) => m.id)) {
    const u = P(id).userData as Record<string, unknown>;
    assert.ok(typeof u.open === "function" || u.cover, `${id} is marked openable but has no open()/cover`);
  }
  (P("door").userData.open as (a: number) => void)(1.2);
  (P("fridge").userData.open as (a: number) => void)(0.9);
  (P("traffic_light").userData.set as (s: string) => void)("green");
  (P("wall_clock").userData.update as (s: number) => void)(3 * 3600);
  (P("kilimanjaro").userData.setLook as () => void)();
  (P("sky_campus").userData.set as (o: object) => void)({ day: 0, storm: 1 });
  assert.equal(P("tower_bridge").userData.prop.id, "tower_bridge");
});

test("props: the film kits' own props are present with the right provenance", () => {
  const by = (s: string) => Object.values(PROP_META).filter((m) => m.source === s).map((m) => m.id);
  for (const id of ["bed_boarding", "mosquito_net", "tin_trunk", "window_barred", "kanga", "bankers_lamp", "elixir_bottle", "library_table", "bookshelf", "jacaranda", "hedge", "campus_block", "kilimanjaro", "sky_campus"]) assert.ok(by("The Bob").includes(id), `${id} should be from The Bob`);
  for (const id of ["bus", "cab", "van", "car", "river_boat", "train", "f16", "b2", "tree", "union_jack", "bridge_lamp", "person", "crowd", "tower_bridge", "elizabeth_tower", "shard", "london_eye", "st_pauls", "city_block", "sky_london", "water_thames"]) assert.ok(by("Low Pass").includes(id), `${id} should be from Low Pass`);
  for (const id of ["bicycle", "street_lamp", "bench", "bin", "bollard", "traffic_light", "bus_stop", "phone_box", "post_box", "bush", "rock", "flower_bed", "sofa", "office_desk", "fridge"]) assert.ok(by("new").includes(id), `${id} should be new`);
});

// ---------------------------------------------------------------- sets

const allSets = () => parseShow(librarySets().map((s) => `include ${s}`).join("\n"));

test("sets: every library set parses clean and uses only real props", () => {
  const names = librarySets();
  for (const n of ["boarding_room", "library_corner", "staffroom", "veranda_corridor", "classroom", "living_room", "office", "cafe", "london_street", "park"]) assert.ok(names.includes(n), `missing set ${n}`);
  const show = allSets();
  assert.deepEqual(show.errors, []);
  for (const s of Object.values(show.sets)) {
    assert.ok(s.dress.length >= 5, `${s.id} is barely dressed`);
    assert.ok(Object.keys(s.anchors).length >= 4, `${s.id} has too few anchors`);
    assert.ok(s.anchors[s.entrance], `${s.id} entrance ${s.entrance} is not an anchor`);
    for (const d of s.dress) assert.ok(PROP_META[d.kind], `${s.id} dresses unknown prop ${d.kind}`);
    assert.ok(s.from === s.id);
  }
});

test("sets: stand marks are inside the set and clear of furniture, so people can use them", () => {
  const show = allSets();
  for (const s of Object.values(show.sets)) {
    const g = setGeometry(s);
    for (const a of Object.values(s.anchors)) {
      assert.ok(Math.abs(a.x) <= s.w / 2 && Math.abs(a.z) <= s.d / 2, `${s.id}.${a.id} is outside the set`);
      const own = a.furniture ? furnitureSpec(a.furniture) : null;
      if (own?.sittable || (own && own.placement === "behind")) continue; // you stand/sit on or at these
      for (const b of g.obstacles) {
        if (!b.solid || b.sittable) continue;
        assert.ok(cylinderInto(b, a.x, a.z, 0.2, 1.7) <= 0.04, `${s.id}: ${a.id} stands inside ${b.id}`);
      }
    }
    for (const b of g.boxes.filter((x) => !x.dress && x.solid && !x.decor)) assert.ok(Math.abs(b.cx) < s.w / 2 + 0.5 && Math.abs(b.cz) < s.d / 2 + 0.5, `${s.id}: ${b.id} is outside the walls`);
  }
});

test("sets: boxes carry their prop, rotation and decor flag; open sets get free space round them", () => {
  const show = allSets();
  const cafe = setGeometry(show.sets.cafe);
  assert.ok(cafe.boxes.every((b) => b.prop && PROP_META[b.prop]), "every cafe box names a library prop");
  const table = cafe.boxes.find((b) => b.kind === "dining_table")!;
  assert.equal(table.dress, true);
  assert.equal(table.solid, true);
  const plate = cafe.boxes.find((b) => b.kind === "plate")!;
  assert.equal(plate.decor, true);
  assert.ok(!cafe.obstacles.includes(plate));
  assert.ok(Math.abs(plate.y - 0.75) < 1e-9, "a plate dressed at height 0.75 sits there");
  const till = cafe.boxes.find((b) => b.id === "till")!;
  assert.equal(till.prop, "kitchen_counter");
  assert.ok(Math.abs(Math.cos(till.ry - till.yaw) + 1) < 1e-9, "furniture in front of a mark faces the mark");
  const seat = cafe.boxes.find((b) => b.id === "seat_a1")!;
  assert.equal(seat.sittable, true);
  const street = setGeometry(show.sets.london_street);
  assert.ok(street.w > show.sets.london_street.w && street.h > 20);
  assert.ok(!street.obstacles.some((b) => b.kind === "sky_london"), "skies are never obstacles");
  assert.ok(street.boxes.some((b) => b.kind === "sky_london"));
});

test("include: later lines extend the set, `as` renames it, and mistakes are explained", () => {
  const ext = parseShow(`include cafe\n  anchor stool at 0 0 face 0 is bench\n  dress bin at 1 1\n  prop ketchup at 0.5 0.5 height 0.75 is mug\ninclude office as hq`);
  assert.deepEqual(ext.errors, []);
  assert.ok(ext.sets.cafe.anchors.stool && ext.sets.cafe.anchors.till, "extended, not replaced");
  assert.ok(ext.sets.hq && !ext.sets.office, "renamed");
  assert.equal(ext.sets.cafe.props.ketchup.kind, "mug");
  const bad = parseShow(`include nowhere\ninclude cafe\ninclude cafe\ndress sofa at 1\ndress teapot_9000 at 1 1\nset room size 4 4\n  dress sofa at 0 0 on missing`);
  const msgs = bad.errors.map((e) => e.message);
  assert.ok(msgs.some((m) => /unknown library set "nowhere" \(have: boarding_room/.test(m)));
  assert.ok(msgs.some((m) => /set "cafe" is already defined/.test(m)));
  assert.ok(msgs.some((m) => /dress needs `at x z`/.test(m)));
  assert.ok(msgs.some((m) => /unknown prop "teapot_9000"/.test(m)));
  assert.ok(msgs.some((m) => /dress sofa is on unknown anchor missing/.test(m)));
  assert.ok(parseShow(`set a size 3 3\n  anchor x at 0 0 is spaceship`).errors.some((e) => /unknown furniture "spaceship"/.test(e.message)));
  // an injected resolver replaces the library folder (the Project and tests can point elsewhere)
  assert.deepEqual(parseShow(`include mine\n`, { sets: (n) => (n === "mine" ? "set mine size 3 3\n  anchor a at 0 0\n  dress bin at 1 1\n" : null) }).errors, []);
  const nested = parseShow(`include loop`, { sets: () => "include cafe\nset x size 2 2" });
  assert.ok(nested.errors.some((e) => /cannot include another set/.test(e.message)));
});

// ---------------------------------------------------------------- compile + QC

const episode = (set: string, body: string) => `episode 1 "t"\n\nscene 1 ${set} day\n${body}`;
const cast = `cast kiran name "Kiran" height 1.74 color teal voice male\ncast mum name "Mum" height 1.63 color coral voice female\n`;

function check(showSrc: string, ep: string) {
  const show = parseShow(showSrc);
  assert.deepEqual(show.errors, []);
  const ws = workspace(show, parseEpisode(ep));
  return { ws, show };
}

test("QC: dressed furniture is an obstacle, small dressing is not, and the report says what it checked", () => {
  const src = `show "t"\n${cast}include cafe\n  anchor ghost at -1.6 0.6 face 0 is none\n  anchor east at 0 0.6 face 270 is none\n`;
  const walk = check(src, episode("cafe", `1A WS\n  kiran@east enter\n  kiran walk ghost\n`));
  assert.ok(walk.ws.qc.issues.some((i) => i.check === "furniture" && /dining_table/.test(i.message)), "walking through the dressed table is caught");
  assert.ok(!walk.ws.qc.issues.some((i) => i.check === "furniture" && /plate|mug|cake|kettle/.test(i.message)), "a plate on a table is not an obstacle");
  assert.ok(walk.ws.qc.checked.some((c) => /set dressing/.test(c)));
  const ok = check(`show "t"\n${cast}include cafe\n`, episode("cafe", `1A WS\n  kiran@till enter\n  kiran walk aisle\n`));
  assert.ok(!ok.ws.qc.issues.some((i) => i.check === "furniture"), JSON.stringify(ok.ws.qc.issues.filter((i) => i.check === "furniture")));
});

test("QC: sitting needs a seat", () => {
  const src = `show "t"\n${cast}include cafe\n  anchor floor at 0.2 -0.4 face 0 is none\n`;
  const bad = check(src, episode("cafe", `1A MS kiran\n  kiran@floor enter\n  kiran sit\n`));
  assert.ok(bad.ws.qc.issues.some((i) => i.check === "seat"), "sitting on the bare floor warns");
  const good = check(src, episode("cafe", `1A MS kiran\n  kiran@seat_a1 enter\n  kiran sit\n`));
  assert.ok(!good.ws.qc.issues.some((i) => i.check === "seat"), "a chair is a seat");
});

test("compile: baked sets carry boxes with props, dressing and prop kinds", () => {
  const { ws } = check(`show "t"\n${cast}include library_corner\n`, episode("library_corner", `1A WS\n  kiran@door enter\n  kiran walk reading_chair\n`));
  const baked = bake(ws.compiled);
  const set = baked.sets.library_corner;
  assert.equal(set.open, false);
  assert.ok(set.boxes.length >= 8);
  assert.ok(set.boxes.filter((b) => b.dress).length >= 6);
  assert.ok(set.boxes.every((b) => b.prop && typeof b.ry === "number" && typeof b.y === "number"));
  assert.deepEqual(set.props.map((p) => p.kind).sort(), ["bankers_lamp", "leather_book", "paper_note"]);
  const street = bake(check(`show "t"\n${cast}include london_street\n`, episode("london_street", `1A WS\n  kiran@edge_w enter\n  kiran walk bus_stop\n`)).ws.compiled);
  assert.equal(street.sets.london_street.open, true);
});

test("QC: the camera solver treats decor as air and obstacles as walls", () => {
  const { ws } = check(`show "t"\n${cast}include living_room\n`, episode("living_room", `1A MCU kiran\n  kiran@sofa enter\n  kiran sit\n`));
  assert.ok(!ws.qc.issues.some((i) => i.check === "camera"), JSON.stringify(ws.qc.issues.filter((i) => i.check === "camera")));
});

// ---------------------------------------------------------------- catalog

test("catalog: every prop and every set is an asset, and SCENE can list them", () => {
  const cat = scanLibrary(LIBRARY_DIR);
  assert.deepEqual(cat.problems, []);
  const props = cat.assets.filter((a) => a.kind === "prop");
  const sets = cat.assets.filter((a) => a.kind === "set");
  assert.equal(props.length, Object.keys(PROP_META).length);
  assert.equal(sets.length, librarySets().length);
  for (const a of props) { assert.ok(a.urls.module?.startsWith("/library/props/"), a.id); assert.ok(existsSync(join(LIBRARY_DIR, a.dir, a.files.module))); }
  for (const a of sets) assert.ok(a.urls.scene?.endsWith(".scene"), a.id);
  const v = sceneVocabulary(LIBRARY_DIR);
  assert.ok(v.props.includes("bus_stop") && v.sets.includes("cafe"));
  assert.ok(loadCatalog(LIBRARY_DIR).assets.length >= 121);
});
