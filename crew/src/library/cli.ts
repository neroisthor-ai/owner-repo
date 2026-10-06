// `crew library ...`: build, search and (re)generate the asset library.

import { LIBRARY_DIR } from "../project.ts";
import { buildCatalog, getAsset, loadCatalog, searchCatalog } from "./catalog.ts";
import { importTheBob } from "./import/bob.ts";
import { importLowPass, importOdyssey } from "./import/films.ts";
import { writeManifests } from "./manifests.ts";
import { portAll } from "./port.ts";

const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`;

export async function libraryCmd(pos: string[], flags: Record<string, string | true>) {
  const [sub = "list", ...rest] = pos;
  switch (sub) {
    case "list": case "search": {
      const cat = loadCatalog(LIBRARY_DIR);
      const hits = searchCatalog(cat, rest.join(" "), { kind: typeof flags.kind === "string" ? flags.kind : undefined });
      for (const a of hits) console.log(`${a.id.padEnd(24)} ${a.kind.padEnd(10)} ${mb(a.bytes).padStart(8)}  ${a.title}`);
      console.log(`\n${hits.length} of ${cat.assets.length} assets${cat.problems.length ? `, ${cat.problems.length} problems (run crew library build)` : ""}`);
      return;
    }
    case "info": {
      const a = getAsset(loadCatalog(LIBRARY_DIR), rest[0] ?? "");
      if (!a) throw new Error(`no asset ${rest[0]}`);
      console.log(JSON.stringify(a, null, 2));
      return;
    }
    case "measure": {
      // re-measure every prop builder and print the meta.js fields that drifted (paste them into library/props/meta.js)
      const { installCanvasShim, THREE } = await import("./node-three.ts");
      installCanvasShim();
      const { PROPS } = await import("../../library/props/index.js");
      const r2 = (x: number) => Math.round(x * 100) / 100;
      let drift = 0;
      for (const [id, p] of Object.entries(PROPS)) {
        const b = new THREE.Box3().setFromObject(p.build()), s = b.getSize(new THREE.Vector3());
        const now = { size: [r2(s.x), r2(s.y), r2(s.z)], y0: r2(b.min.y), center: [r2((b.min.x + b.max.x) / 2), r2((b.min.z + b.max.z) / 2)] };
        const was = { size: p.size, y0: p.y0, center: p.center };
        if (JSON.stringify(now) !== JSON.stringify(was)) { drift++; console.log(`${id}: ${JSON.stringify(was)} -> ${JSON.stringify(now)}`); }
      }
      console.log(drift ? `\n${drift} props drifted` : `all ${Object.keys(PROPS).length} props match meta.js`);
      process.exitCode = drift ? 1 : 0;
      return;
    }
    case "port": {
      for (const f of portAll(LIBRARY_DIR)) console.log(`wrote ${f}`);
      writeManifests(LIBRARY_DIR, true);
      const c = buildCatalog(LIBRARY_DIR);
      console.log(`catalog: ${c.assets.length} assets`);
      return;
    }
    case "import": {
      // crew library import <the-bob-folder> <low-pass.html> <Odyssey.html>   (any may be "-")
      const [bob, lowpass, odyssey] = rest;
      if (bob && bob !== "-") console.log((await importTheBob(bob, LIBRARY_DIR)).notes.join("\n"));
      if (lowpass && lowpass !== "-") console.log(importLowPass(lowpass, LIBRARY_DIR).notes.join("\n"));
      if (odyssey && odyssey !== "-") console.log(importOdyssey(odyssey, LIBRARY_DIR).notes.join("\n"));
      for (const f of portAll(LIBRARY_DIR)) console.log(`ported ${f}`);
      writeManifests(LIBRARY_DIR, true);
      const c = buildCatalog(LIBRARY_DIR);
      console.log(`catalog: ${c.assets.length} assets, ${c.problems.length} problems`);
      return;
    }
    case "build": {
      writeManifests(LIBRARY_DIR, !!flags.force);
      const c = buildCatalog(LIBRARY_DIR);
      console.log(`catalog: ${c.assets.length} assets, ${mb(c.assets.reduce((s, a) => s + a.bytes, 0))}`);
      for (const p of c.problems) console.log(`  problem: ${p}`);
      process.exitCode = c.problems.length ? 1 : 0;
      return;
    }
    default:
      throw new Error("usage: crew library list|search <q>|info <id>|build|measure|port|import <bob> <low-pass.html> <Odyssey.html>");
  }
}
