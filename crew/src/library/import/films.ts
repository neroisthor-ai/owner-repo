// Import the two single-file films: "Low Pass" (London, OSM buildings, Thames,
// aircraft, traffic, crowds, HDR pipeline) and "Scylla and Charybdis" / Odyssey
// (raymarched storm ocean, score). Data becomes open formats (GeoJSON, M4A, GLSL);
// code is kept verbatim as reference and ported into library/kits + effects.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ImportLog } from "./bob.ts";

// Low Pass local frame: Tower Bridge origin, metres; x east, z south.
export const LOWPASS_FRAME = { lat0: 51.5055, lon0: -0.0754, kx: 69296, kz: 111200 };
const toLL = (x: number, z: number) => [Math.round((x / LOWPASS_FRAME.kx + LOWPASS_FRAME.lon0) * 1e7) / 1e7, Math.round((LOWPASS_FRAME.lat0 - z / LOWPASS_FRAME.kz) * 1e7) / 1e7];

/** Find `name=` (or `const NAME=`) followed by a JS array/object literal in a big source and return the literal text. */
function literalAfter(src: string, marker: string): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`${marker} not found`);
  let i = at + marker.length;
  while (src[i] !== "[" && src[i] !== "{") i++;
  const open = src[i], close = open === "[" ? "]" : "}";
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") { depth--; if (depth === 0 && ch === close) break; }
  }
  return src.slice(start, i + 1);
}

/** Parse an MP4/M4A's movie duration from its mvhd box. */
export function mp4Duration(buf: Buffer): number | null {
  const find = (start: number, end: number, type: string): [number, number] | null => {
    let p = start;
    while (p + 8 <= end) {
      let size = buf.readUInt32BE(p);
      const t = buf.toString("ascii", p + 4, p + 8);
      if (size === 1) size = Number(buf.readBigUInt64BE(p + 8));
      if (size < 8) return null;
      if (t === type) return [p, p + size];
      p += size;
    }
    return null;
  };
  const moov = find(0, buf.length, "moov");
  if (!moov) return null;
  const mvhd = find(moov[0] + 8, moov[1], "mvhd");
  if (!mvhd) return null;
  const v = buf[mvhd[0] + 8];
  const ts = v === 1 ? buf.readUInt32BE(mvhd[0] + 28) : buf.readUInt32BE(mvhd[0] + 20);
  const dur = v === 1 ? Number(buf.readBigUInt64BE(mvhd[0] + 32)) : buf.readUInt32BE(mvhd[0] + 24);
  return Math.round((dur / ts) * 1000) / 1000;
}

export function importLowPass(file: string, lib: string, log: ImportLog = { wrote: [], notes: [] }): ImportLog {
  const html = readFileSync(file, "utf8");
  const w = (p: string, data: string | Buffer) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, data); log.wrote.push(p); };
  const raw = JSON.parse(literalAfter(html, "window.__OSM=")) as [number[], number, number, number, number, number][];

  // compact form (what the kit consumes) + GeoJSON (what every GIS tool reads)
  const out = join(lib, "data", "london_osm");
  const features = raw.map((r, i) => {
    const p = r[0];
    const ring: number[][] = [];
    for (let k = 0; k < p.length; k += 2) ring.push(toLL(p[k] / 10, p[k + 1] / 10));
    if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0]);
    return {
      type: "Feature", id: i,
      properties: { height: r[1] / 10, minHeight: r[2] / 10, roofShape: r[3], roofHeight: r[4] / 10, colour: r[5] < 0 ? null : `#${r[5].toString(16).padStart(6, "0")}` },
      geometry: { type: "Polygon", coordinates: [ring] },
    };
  });
  w(join(out, "buildings.geojson"), JSON.stringify({ type: "FeatureCollection", name: "Central London buildings (Low Pass)", features }));
  w(join(out, "buildings.compact.json"), JSON.stringify({
    frame: LOWPASS_FRAME,
    schema: "[footprint (x,z pairs in decimetres in the local frame), height dm, min height dm, roof shape code, roof height dm, sRGB colour int or -1]",
    roofShapes: "0, 4, 7 flat; 5 dome and 6 onion (two-ring profile); any other code peaks to an apex",
    buildings: raw,
  }));
  const heights = raw.map((r) => r[1] / 10).sort((a, b) => a - b);
  w(join(out, "asset.json"), JSON.stringify({
    id: "london_osm", kind: "data", title: "Central London: OpenStreetMap buildings", tags: ["london", "osm", "buildings", "gis", "low-pass"],
    source: { project: "Low Pass", file: "low-pass.html (window.__OSM)" },
    files: { geojson: "buildings.geojson", compact: "buildings.compact.json" },
    meta: { buildings: raw.length, maxHeight: heights[heights.length - 1], medianHeight: heights[Math.floor(heights.length / 2)], frame: LOWPASS_FRAME, licence: "Map data © OpenStreetMap contributors, ODbL" },
  }, null, 2));

  // geography the film placed by hand: Thames centreline, parks, landmark coordinates
  const js = html.slice(html.lastIndexOf("<script>"));
  const river = new Function(`return ${literalAfter(js, "const RIVER_LL=")}`)() as number[][];
  const parks = new Function(`return ${literalAfter(js, "const PARKS=")}`)() as number[][];
  const geo = join(lib, "data", "london_geography");
  w(join(geo, "thames.geojson"), JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "River Thames (centreline, Battersea to Greenwich reach)", halfWidth: 122 }, geometry: { type: "LineString", coordinates: river.map(([la, lo]) => [lo, la]) } }] }));
  w(join(geo, "parks.geojson"), JSON.stringify({ type: "FeatureCollection", features: parks.map(([la, lo, wd, dp, rot]) => ({ type: "Feature", properties: { width: wd, depth: dp, rotation: rot, shape: "ellipse" }, geometry: { type: "Point", coordinates: [lo, la] } })) }));
  const landmarks = [
    ["Tower Bridge", 51.5055, -0.0754], ["Elizabeth Tower (Big Ben)", 51.5007, -0.1246], ["Victoria Tower", 51.4981, -0.1253], ["Westminster Abbey", 51.4994, -0.1273],
    ["Portcullis House", 51.5013, -0.125], ["The Shard", 51.5045, -0.0865], ["London Eye", 51.5033, -0.1196], ["St Paul's Cathedral", 51.5138, -0.0984],
    ["Tower of London", 51.5081, -0.0759], ["HMS Belfast", 51.5066, -0.0813], ["City Hall", 51.5049, -0.0786], ["One Canada Square", 51.5049, -0.0195],
    ["BT Tower", 51.5215, -0.1389], ["Battersea Power Station", 51.4816, -0.1445], ["St George Wharf Tower", 51.4855, -0.126], ["MI6 Building", 51.4872, -0.1244],
    ["London Bridge", 51.5079, -0.0877], ["Southwark Bridge", 51.5087, -0.0944], ["Millennium Bridge", 51.5095, -0.0985], ["Blackfriars Bridge", 51.5098, -0.1045],
    ["Waterloo Bridge", 51.5085, -0.1168], ["Hungerford Bridge", 51.5066, -0.1203], ["Westminster Bridge", 51.5008, -0.1222], ["Lambeth Bridge", 51.4945, -0.1243],
    ["Vauxhall Bridge", 51.4875, -0.1275], ["Chelsea Bridge", 51.4845, -0.15], ["Albert Bridge", 51.4822, -0.1665], ["Cannon Street Railway Bridge", 51.5093, -0.0916],
  ];
  w(join(geo, "landmarks.geojson"), JSON.stringify({ type: "FeatureCollection", features: landmarks.map(([n, la, lo]) => ({ type: "Feature", properties: { name: n }, geometry: { type: "Point", coordinates: [lo, la] } })) }));
  w(join(geo, "asset.json"), JSON.stringify({
    id: "london_geography", kind: "data", title: "London: Thames centreline, parks, landmarks", tags: ["london", "river", "thames", "landmarks", "low-pass"],
    source: { project: "Low Pass", file: "low-pass.html" }, files: { thames: "thames.geojson", parks: "parks.geojson", landmarks: "landmarks.geojson" },
    meta: { riverPoints: river.length, parks: parks.length, landmarks: landmarks.length, frame: LOWPASS_FRAME },
  }, null, 2));

  // the film source itself, without the 6 MB data blob, as reference
  const ref = join(lib, "reference", "low_pass");
  w(join(ref, "low-pass.js"), js.replace(/^<script>\n?/, "").replace(/<\/script>[\s\S]*$/, ""));
  log.notes.push(`Low Pass: ${raw.length} OSM buildings, Thames (${river.length} pts), ${parks.length} parks, ${landmarks.length} landmarks`);
  return log;
}

export function importOdyssey(file: string, lib: string, log: ImportLog = { wrote: [], notes: [] }): ImportLog {
  const html = readFileSync(file, "utf8");
  const w = (p: string, data: string | Buffer) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, data); log.wrote.push(p); };
  // score
  const m = html.match(/window\.__AUDIO_B64\s*=\s*"([A-Za-z0-9+/=]+)"/);
  if (m) {
    const audio = Buffer.from(m[1], "base64");
    const out = join(lib, "music", "odyssey_score");
    w(join(out, "score.m4a"), audio);
    w(join(out, "asset.json"), JSON.stringify({
      id: "odyssey_score", kind: "music", title: "Scylla and Charybdis: score", tags: ["odyssey", "score", "storm", "epic"],
      source: { project: "Odyssey (Scylla and Charybdis)", file: "Odyssey.html (window.__AUDIO_B64)" }, files: { audio: "score.m4a" },
      meta: { bytes: audio.length, seconds: mp4Duration(audio), codec: "AAC in MP4" },
    }, null, 2));
  }
  // shaders, verbatim, one file per <script type="x-shader">
  const shaders = join(lib, "effects", "odyssey_ocean", "glsl");
  const names: string[] = [];
  for (const s of html.matchAll(/<script id="(\w+)" type="x-shader">([\s\S]*?)<\/script>/g)) {
    w(join(shaders, `${s[1]}.glsl`), s[2].replace(/^\n/, ""));
    names.push(s[1]);
  }
  // the driver, verbatim, as reference for the port
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]).filter((x) => !x.includes("window.__AUDIO_B64 ="));
  w(join(lib, "reference", "odyssey", "odyssey.js"), scripts.join("\n"));
  copyFileSync(file, join(lib, "reference", "odyssey", "Odyssey.html"));
  log.wrote.push(join(lib, "reference", "odyssey", "Odyssey.html"));
  log.notes.push(`Odyssey: score ${m ? "extracted" : "missing"}, ${names.length} shaders (${names.join(", ")})`);
  return log;
}
