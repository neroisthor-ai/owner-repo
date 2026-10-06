// Builds a static copy of the frontend that opens the current project with no server (for hosting a preview).
// Usage: node scripts/build-static.mjs <outDir> [serverUrl]   (the server must be running to read the project's state)
// Notes, takes and voices need the server; everything that runs in the browser (timeline editing, look, exports) works.
import { cpSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [out = "/tmp/crew-static", server = "http://localhost:4310"] = process.argv.slice(2);
rmSync(out, { recursive: true, force: true });
for (const d of ["vendor/three/addons/exporters", "vendor/mp4-muxer", "library/props"]) mkdirSync(join(out, d), { recursive: true });
for (const f of ["app.js", "app.css", "crew-ui.css", "ui.css"]) cpSync(join(root, "web", f), join(out, f));
cpSync(join(root, "web/crew"), join(out, "crew"), { recursive: true });
cpSync(join(root, "library/props"), join(out, "library/props"), { recursive: true, filter: (s) => !s.includes("_manifests") });
// only the characters the film uses are copied; the asset library itself stays backend-only
// they ship as base64 inside chars.json (a data file), because static hosts often refuse .glb; the shim below serves them back as bytes
const chars = {};
for (const [c, f] of [["makehuman_male", "human_male.glb"], ["makehuman_female", "human_female.glb"]]) chars[`/library/characters/${c}/${f}`] = readFileSync(join(root, "library/characters", c, f)).toString("base64");
writeFileSync(join(out, "chars.json"), JSON.stringify(chars));
const nm = (p) => join(root, "node_modules", p);
cpSync(nm("three/build/three.module.js"), join(out, "vendor/three/three.module.js"));
cpSync(nm("three/build/three.core.js"), join(out, "vendor/three/three.core.js"));
cpSync(nm("three/examples/jsm/exporters/GLTFExporter.js"), join(out, "vendor/three/addons/exporters/GLTFExporter.js"));
cpSync(nm("mp4-muxer/build/mp4-muxer.mjs"), join(out, "vendor/mp4-muxer/mp4-muxer.mjs"));
const state = await (await fetch(`${server}/api/state`)).text();
writeFileSync(join(out, "state.json"), state);
const shim = `<script>
// No server here: /api/state comes from state.json, everything else says so plainly.
(() => {
  const real = window.fetch.bind(window);
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  window.fetch = (u, o) => {
    const url = new URL(typeof u === "string" ? u : u.url, location.href);
    if (url.pathname.endsWith(".glb")) return (window.__chars ??= real(new URL("chars.json", document.baseURI)).then((r) => r.json())).then((m) => m[url.pathname] ? new Response(Uint8Array.from(atob(m[url.pathname]), (c) => c.charCodeAt(0)), { headers: { "content-type": "model/gltf-binary" } }) : new Response("", { status: 404 }));
    if (url.pathname.startsWith("/library/") || url.pathname.startsWith("/assets/")) return real(new URL("." + url.pathname, document.baseURI), o); // served from this copy
    if (!url.pathname.startsWith("/api/")) return real(u, o);
    if (url.pathname === "/api/state") return real(new URL("state.json", document.baseURI)).then(async (r) => json(await r.json()));
    return Promise.resolve(json({ error: "This preview has no Crew server, so notes, takes and voices are off. Run npm start to use them." }, 503));
  };
  window.EventSource = undefined;
})();
</script>`;
writeFileSync(join(out, "index.html"), `<title>Crew</title>
<meta name="theme-color" content="#1e1e20" />
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="app.css" />
<link rel="stylesheet" href="crew-ui.css" />
<link rel="stylesheet" href="ui.css" />
<style>html, body { height: 100%; background: #1e1e20; color-scheme: dark; } :root { padding: 0 !important; }</style>
${shim}
<div id="root"></div>
<script type="importmap">{"imports":{"three":"./vendor/three/three.module.js","three/addons/":"./vendor/three/addons/","/vendor/":"./vendor/","/library/":"./library/","/crew/":"./crew/","/app.js":"./app.js"}}</script>
<script type="module" src="crew/boot.js"></script>
`);
console.log("static build in", out);
