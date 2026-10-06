// Local web server: the browser animatic + notes UI, a JSON API, and an SSE
// stream of crew activity. No framework; everything goes through the Crew facade.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Crew, pickLLM } from "./index.ts";
import { bake } from "./scene/compile.ts";
import { fmtTime } from "./crew/prompts.ts";
import { structure } from "./scene/parse.ts";
import { designFor } from "./voice/bank.ts";
import { CREW_ROOT, LIBRARY_DIR } from "./project.ts";
import { connectKey, sameOrigin } from "./claude/setup.ts";
import { hasCredentials } from "./claude/llm.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "web");
const THREE = join(ROOT, "node_modules", "three", "build");
const MUXER = join(ROOT, "node_modules", "mp4-muxer", "build");
const ADDONS = join(ROOT, "node_modules", "three", "examples", "jsm");
const ASSETS = join(ROOT, "assets");
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".glb": "model/gltf-binary", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".geojson": "application/geo+json", ".glsl": "text/plain; charset=utf-8", ".bob1": "application/octet-stream", ".png": "image/png", ".jpg": "image/jpeg" };

export function startServer(crew: Crew, port = 4310): Promise<{ url: string; close: () => void }> {
  const clients = new Set<ServerResponse>();
  const broadcast = (event: string, data: unknown) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(msg);
  };
  crew.events.on("crew", (e) => broadcast("crew", e));
  crew.events.on("changed", (h) => broadcast("changed", h));
  const previews = new Map<string, unknown>();
  crew.events.on("changed", () => previews.clear());

  const state = () => {
    const p = crew.project;
    return {
      title: p.show.title, episode: p.episodeFile, episodes: p.episodes, source: crew.source, showSource: p.showSrc,
      addresses: (() => { const st = structure(p.ws.doc); return p.ws.doc.lines.map((_l, i) => st.addrOf.get(i) ?? ""); })(),
      baked: crew.bake(), qc: crew.qc, grammar: p.ws.grammar, history: p.history.slice(-40).reverse(),
      assets: { characters: { male: "/library/characters/makehuman_male/human_male.glb", female: "/library/characters/makehuman_female/human_female.glb", rig: "/library/rigs/makehuman.json" }, props: { registry: "/library/props/index.js" } },
      notes: p.notes.slice(-25).reverse(), metrics: p.metrics(), mode: crew.llm.mode, hasKey: hasCredentials(),
      shots: crew.compiled.shots.map((s) => ({ id: s.id, label: s.label, start: fmtTime(s.cutStart), dur: s.cutDur, hash: s.hash })),
    };
  };

  const routes: Record<string, (body: Record<string, unknown>, req: IncomingMessage, url: URL) => Promise<unknown> | unknown> = {
    "GET /api/state": () => state(),
    "POST /api/note": (b) => crew.note(String(b.note ?? ""), { parent: b.parent ? String(b.parent) : undefined }),
    "GET /api/preview": (_b, _r, url) => {
      const noteId = url.searchParams.get("note") ?? "", takeId = url.searchParams.get("take") ?? "";
      const key = `${noteId}/${takeId}`;
      if (previews.has(key)) return previews.get(key);
      const n = crew.project.notes.find((x) => x.id === noteId);
      const t = n?.takes.find((x) => x.id === takeId);
      if (!n || !t) throw new HttpError(404, "no such take");
      const ev = crew.project.check(t.patch, { role: "director", allowed: new Set(n.targets.concat(t.changedShots)) });
      if (!ev.ok || !ev.after) throw new HttpError(409, `take no longer applies: ${ev.reasons.join("; ")}`);
      const out = { baked: bake(ev.after.compiled), changedShots: ev.changedShots, source: ev.after.doc.lines.map((l) => l.text).join("\n") };
      previews.set(key, out);
      return out;
    },
    "POST /api/accept": (b) => { const r = crew.accept(String(b.noteId), String(b.takeId)); return { ok: true, history: r.history }; },
    "POST /api/reject": (b) => crew.reject(String(b.noteId)),
    "POST /api/rate": (b) => crew.rate(String(b.noteId), b.rating === "worse" ? "worse" : "better"),
    "POST /api/patch": (b) => {
      const r = crew.patch(String(b.patch ?? ""), { role: (b.role as never) ?? "director", dryRun: !!b.dryRun, allowSpill: !!b.allowSpill, allowNewErrors: !!b.allowNewErrors });
      return { ...r, after: undefined };
    },
    "PUT /api/episode": (b) => { crew.setEpisode(String(b.source ?? "")); return { ok: true, grammar: crew.project.ws.grammar }; },
    "POST /api/undo": () => ({ undone: crew.undo() }),
    "POST /api/write": async (b) => crew.write(String(b.script ?? ""), { apply: !!b.apply }),
    "POST /api/screen": async (b) => crew.screen(Number(b.viewers ?? 5)),
    "POST /api/voices": async (b) => crew.voices({ engine: b.engine ? String(b.engine) : undefined, force: !!b.force, prune: !!b.prune }),
    "GET /api/voices": () => {
      const p = crew.project, presets = p.voices.presets();
      const look = p.voices.lookup(p.show);
      return {
        presets,
        cast: Object.values(p.show.cast).map((c) => { let design: unknown = null; try { design = designFor(c, presets); } catch (e) { design = { error: (e as Error).message }; } return { id: c.id, tts: c.tts, design }; }),
        lines: p.dialogueLines().map((l) => ({ ...l, clip: look(l.actor, l.verb, l.text) ? p.voices.clips[look(l.actor, l.verb, l.text)!.key] : null })),
      };
    },
    "GET /api/otio": () => crew.otio(),
    "POST /api/key": async (b, req) => {
      if (!sameOrigin(req.headers.host, req.headers.origin, req.headers["content-type"])) throw new HttpError(403, "That request didn't come from the Crew page.");
      const r = await connectKey({ key: b.key, envPath: join(CREW_ROOT, ".env"), apply: (k) => { process.env.ANTHROPIC_API_KEY = k; crew.llm = pickLLM("claude"); } });
      if (!r.ok) throw new HttpError(400, r.error ?? "Couldn't use that key.");
      return { mode: crew.llm.mode, hasKey: true };
    },
    "POST /api/mode": (b) => {
      if (b.llm === "claude" || b.llm === "offline") crew.llm = pickLLM(b.llm);
      return { mode: crew.llm.mode };
    },
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(": crew\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      const route = routes[`${req.method} ${url.pathname}`];
      if (route) {
        const body = req.method === "GET" ? {} : await readJson(req);
        const out = await route(body, req, url);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
        return;
      }
      if (url.pathname.startsWith("/api/")) throw new HttpError(404, "unknown endpoint");
      if (req.method !== "GET") throw new HttpError(405, "method not allowed");
      const file = url.pathname.startsWith("/vendor/three/addons/") ? safeJoin(ADDONS, url.pathname.slice("/vendor/three/addons/".length))
        : url.pathname.startsWith("/vendor/three/") ? safeJoin(THREE, url.pathname.slice("/vendor/three/".length))
        : url.pathname.startsWith("/assets/") ? safeJoin(ASSETS, url.pathname.slice("/assets/".length))
        : url.pathname.startsWith("/show-media/voices/") ? safeJoin(crew.project.voices.dir, url.pathname.slice("/show-media/voices/".length))
        : url.pathname.startsWith("/library/") ? safeJoin(LIBRARY_DIR, url.pathname.slice("/library/".length))
        : url.pathname.startsWith("/vendor/mp4-muxer/") ? safeJoin(MUXER, url.pathname.slice("/vendor/mp4-muxer/".length))
        : safeJoin(WEB, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
      if (!file || !existsSync(file) || !statSync(file).isFile()) throw new HttpError(404, "not found");
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
      createReadStream(file).pipe(res);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  });

  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => ok({ url: `http://localhost:${port}`, close: () => { for (const c of clients) c.end(); server.close(); } }));
  });
}

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

function safeJoin(root: string, rel: string): string | null {
  const p = normalize(join(root, decodeURIComponent(rel)));
  return p === root || p.startsWith(root + sep) ? p : null;
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((ok, fail) => {
    let s = "";
    req.on("data", (d) => { s += d; if (s.length > 5e6) { fail(new HttpError(413, "body too large")); req.destroy(); } });
    req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch { fail(new HttpError(400, "invalid JSON")); } });
    req.on("error", fail);
  });
}
