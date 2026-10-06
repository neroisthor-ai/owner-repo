// The library catalog: every asset described by an asset.json next to its files.
// `crew library build` scans library/, checks every referenced file exists, and
// writes library/catalog.json; everything else (API, MCP, SCENE validation,
// the frontend) reads that.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export type AssetKind = "character" | "music" | "data" | "voices" | "looks" | "poses" | "rig" | "kit" | "effect" | "reference" | "prop" | "set";

export interface Asset {
  id: string;
  kind: AssetKind;
  title: string;
  tags: string[];
  source?: { project: string; file?: string; pipeline?: string };
  /** role -> file, relative to the asset's folder */
  files: Record<string, string>;
  meta: Record<string, unknown>;
  /** folder relative to library/ */
  dir: string;
  /** role -> URL the server serves it at */
  urls: Record<string, string>;
  bytes: number;
}

export interface Catalog {
  format: "crew library v1";
  generated: string;
  assets: Asset[];
  problems: string[];
}

function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    if (f.startsWith(".") || f === "node_modules") continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (f === "asset.json") out.push(p);
  }
  return out;
}

export function scanLibrary(lib: string): Catalog {
  const assets: Asset[] = [];
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const f of existsSync(lib) ? walk(lib) : []) {
    let a: Omit<Asset, "dir" | "urls" | "bytes">;
    try { a = JSON.parse(readFileSync(f, "utf8")); } catch (e) { problems.push(`${relative(lib, f)}: ${(e as Error).message}`); continue; }
    const dir = relative(lib, join(f, ".."));
    if (!a.id || !a.kind) { problems.push(`${relative(lib, f)}: needs id and kind`); continue; }
    if (ids.has(a.id)) problems.push(`duplicate asset id ${a.id} (${dir})`);
    ids.add(a.id);
    let bytes = 0;
    const urls: Record<string, string> = {};
    for (const [role, file] of Object.entries(a.files ?? {})) {
      const p = join(lib, dir, file);
      if (!existsSync(p)) { problems.push(`${a.id}: ${role} file missing (${join(dir, file)})`); continue; }
      bytes += statSync(p).isFile() ? statSync(p).size : 0;
      urls[role] = `/library/${join(dir, file).split("\\").join("/")}`;
    }
    assets.push({ ...a, tags: a.tags ?? [], meta: a.meta ?? {}, files: a.files ?? {}, dir, urls, bytes });
  }
  assets.sort((x, y) => x.kind.localeCompare(y.kind) || x.id.localeCompare(y.id));
  return { format: "crew library v1", generated: new Date().toISOString(), assets, problems };
}

export function buildCatalog(lib: string): Catalog {
  const c = scanLibrary(lib);
  writeFileSync(join(lib, "catalog.json"), JSON.stringify(c, null, 1));
  return c;
}

let cached: { lib: string; at: number; cat: Catalog } | null = null;
export function loadCatalog(lib: string): Catalog {
  const f = join(lib, "catalog.json");
  const at = existsSync(f) ? statSync(f).mtimeMs : 0;
  if (cached && cached.lib === lib && cached.at === at) return cached.cat;
  const cat = at ? (JSON.parse(readFileSync(f, "utf8")) as Catalog) : scanLibrary(lib);
  cached = { lib, at, cat };
  return cat;
}

export function getAsset(cat: Catalog, id: string): Asset | undefined {
  return cat.assets.find((a) => a.id === id);
}

/** Simple ranked search over id, title, tags, kind and meta keys/values. */
export function searchCatalog(cat: Catalog, q = "", o: { kind?: string; tag?: string; limit?: number } = {}): Asset[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = cat.assets
    .filter((a) => (!o.kind || a.kind === o.kind) && (!o.tag || a.tags.includes(o.tag)))
    .map((a) => {
      const hay = [a.id, a.title, a.kind, ...a.tags, a.source?.project ?? "", JSON.stringify(a.meta).slice(0, 2000)].join(" ").toLowerCase();
      let s = terms.length ? 0 : 1;
      for (const t of terms) {
        if (a.id.toLowerCase() === t) s += 10;
        if (a.id.toLowerCase().includes(t)) s += 4;
        if (a.title.toLowerCase().includes(t)) s += 3;
        if (a.tags.some((g) => g.includes(t))) s += 2;
        if (hay.includes(t)) s += 1;
      }
      return { a, s };
    })
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s);
  return scored.slice(0, o.limit ?? 50).map((x) => x.a);
}

/** What SCENE can reference: character models, looks, poses, music cues. */
export function sceneVocabulary(lib: string) {
  const cat = loadCatalog(lib);
  const looks: Record<string, string> = {}; // look id -> body (character asset id)
  const poses = new Map<string, Record<string, number[] | number>>();
  for (const a of cat.assets) {
    if (a.kind === "looks" && a.urls.looks) {
      const j = JSON.parse(readFileSync(join(lib, a.dir, a.files.looks), "utf8")) as { bodies: Record<string, string>; looks: Record<string, unknown> };
      for (const l of Object.keys(j.looks)) looks[l] = `bob_${j.bodies[l] ?? l}`;
    }
    if (a.kind === "poses" && a.urls.poses) {
      const j = JSON.parse(readFileSync(join(lib, a.dir, a.files.poses), "utf8")) as { poses: Record<string, Record<string, number[] | number>> };
      for (const [k, v] of Object.entries(j.poses)) poses.set(k.toLowerCase(), v);
    }
  }
  return {
    characters: cat.assets.filter((a) => a.kind === "character").map((a) => a.id),
    looks,
    poses,
    props: cat.assets.filter((a) => a.kind === "prop").map((a) => String(a.meta.prop)),
    sets: cat.assets.filter((a) => a.kind === "set").map((a) => String(a.meta.set)),
    music: Object.fromEntries(cat.assets.filter((a) => a.kind === "music" && a.urls.audio).map((a) => [a.id, a.urls.audio])),
  };
}
