// Storyboard (print and zip) and the phone shoot pack. Frames are real renders from the viewer.
import { baked, server, download, printHtml, esc, toast, tick, zipStore, projectName, episodeName, tc } from "./util.js";

const E = window.CrewExt;
const W = 1280, H = 720;

/** [{shot, t, label, dialogue}] for the chosen frames-per-shot mode. */
export function storyboardFrames(b, mode) {
  const eps = 1 / b.fps;
  const clamp = (s, t) => Math.min(s.cutStart + Math.max(eps, s.cutDur - eps), Math.max(s.cutStart, t));
  const say = (s) => b.audio.filter((a) => a.shot === s.id && a.type === "say").map((a) => `${a.char}: ${a.text}`);
  const out = [];
  for (const s of b.shots) {
    const base = { shot: s, dialogue: say(s) };
    if (mode === "beat") {
      const beats = (s.beats ?? []).filter((x) => x.kind !== "sound");
      if (!beats.length) out.push({ ...base, t: clamp(s, s.cutStart + s.cutDur / 2), label: "middle" });
      for (const x of beats) out.push({ ...base, t: clamp(s, s.cutStart + (x.t0 + x.t1) / 2 - (s.trimHead ?? 0)), label: x.label, dialogue: x.kind === "dialogue" ? [x.label] : [] });
    } else if (mode === "3") {
      for (const [k, f] of [["start", 0.02], ["middle", 0.5], ["end", 0.97]]) out.push({ ...base, t: clamp(s, s.cutStart + s.cutDur * f), label: k });
    } else out.push({ ...base, t: clamp(s, s.cutStart + s.cutDur / 2), label: "middle" });
  }
  return out;
}

/** Render stills with ONE viewer (building a viewer per frame is what makes naive exports slow). */
async function renderFrames(mode, w = W, h = H) {
  const b = baked(), assets = server().assets, list = storyboardFrames(b, mode), blobs = [];
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const v = new (window.__crew.Viewer)(canvas);
  try {
    v.assets = assets ?? null;
    v.setFixedSize([w, h]);
    v.load(b);
    await v.ready();
    v.lookOn = true; v.lookSpp = 1; // real renders: the film look, one pass
    for (let i = 0; i < list.length; i++) {
      if (i % 3 === 0) { toast(`Rendering storyboard frame ${i + 1} of ${list.length}...`); await tick(); }
      v.frame(list[i].t);
      blobs.push(await new Promise((ok, fail) => canvas.toBlob((x) => (x ? ok(x) : fail(new Error("Could not capture a frame."))), "image/png")));
    }
  } finally { v.dispose(true); }
  return { b, list, blobs };
}

const sizeWord = (s) => s.type + (s.subjects?.length ? ` ${s.subjects.join(" ")}` : "");

E.on("Storyboard image export", async ({ frames: mode = "3" }) => {
  const { list, blobs } = await renderFrames(mode);
  const files = [];
  const count = {};
  for (let i = 0; i < list.length; i++) {
    const id = list[i].shot.id;
    count[id] = (count[id] ?? 0) + 1;
    files.push({ name: `${id}_${count[id]}.png`, data: new Uint8Array(await blobs[i].arrayBuffer()) });
  }
  download(`${projectName()}_${episodeName()}_storyboard.zip`, new Blob([zipStore(files)], { type: "application/zip" }));
  toast(`Storyboard: ${files.length} frames in a zip.`);
});

E.on("Storyboard printing", async ({ frames: mode = "3" }) => {
  const { b, list, blobs } = await renderFrames(mode);
  const urls = blobs.map((x) => URL.createObjectURL(x));
  let lastScene = null;
  const cards = list.map((f, i) => {
    const s = f.shot, head = s.scene !== lastScene ? `<h2>Scene ${s.scene} · ${esc(s.set)}</h2>` : "";
    lastScene = s.scene;
    return `${head}<figure><img src="${urls[i]}"><figcaption><b>${esc(s.id)}</b> ${esc(sizeWord(s))} · ${s.lens}mm ${esc(s.move)} · ${esc(f.label)} · ${tc(f.t, b.fps)}${f.dialogue.length ? `<div class="d">${f.dialogue.map(esc).join("<br>")}</div>` : ""}</figcaption></figure>`;
  }).join("");
  printHtml(`<!doctype html><meta charset="utf-8"><title>${esc(server().title)} storyboard</title><style>
    body{font:12px system-ui,sans-serif;margin:16px;color:#111}h1{font-size:18px}h2{grid-column:1/-1;font-size:13px;margin:14px 0 2px;break-after:avoid}
    .g{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}figure{margin:0;break-inside:avoid}img{width:100%;display:block;border:1px solid #888}
    figcaption{padding:3px 0}.d{font-style:italic;color:#444;margin-top:2px}@media print{body{margin:8mm}}
  </style><h1>${esc(server().title)} · ${esc(server().episode)} · storyboard</h1><div class="g">${cards}</div>`);
});

// ---- phone shoot pack -----------------------------------------------------------------

/** White edge lines (transparent elsewhere) from a still, for lining up the real shot. */
async function edgePng(blob) {
  const bmp = await createImageBitmap(blob);
  const w = 640, h = Math.round((640 * bmp.height) / bmp.width);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, w, h);
  const src = g.getImageData(0, 0, w, h), out = g.createImageData(w, h);
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.3 * src.data[i * 4] + 0.59 * src.data[i * 4 + 1] + 0.11 * src.data[i * 4 + 2];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = -lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1] + lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1];
    const gy = -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1] + lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
    const m = Math.min(255, Math.hypot(gx, gy) * 1.4);
    const a = m > 40 ? Math.min(255, m * 1.5) : 0;
    out.data.set([255, 255, 255, a], i * 4);
  }
  g.putImageData(out, 0, 0);
  return c.toDataURL("image/png");
}
const dataUrl = (blob) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });

E.on("The phone shoot pack", async ({ frameLines = "none", outlines = true }) => {
  const { b, list, blobs } = await renderFrames("1", 960, 540);
  const shots = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i].shot;
    shots.push({ id: s.id, label: s.label, lens: s.lens, move: s.move, light: s.light, dur: s.cutDur, dialogue: list[i].dialogue, img: await dataUrl(blobs[i]), edge: outlines ? await edgePng(blobs[i]) : null });
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(server().title)} shoot pack</title><style>
  *{box-sizing:border-box}body{margin:0;font:15px system-ui,sans-serif;background:#0b0c10;color:#e8e8ee}header{padding:14px}h1{font-size:18px;margin:0}small{color:#9aa}
  .list{display:grid;gap:10px;padding:0 12px 24px}.card{display:grid;grid-template-columns:120px 1fr;gap:10px;background:#15171e;border-radius:10px;padding:8px;cursor:pointer}
  .card img{width:120px;border-radius:6px}.card b{font-size:16px}.card p{margin:2px 0;color:#aab;font-size:13px}
  #cam{position:fixed;inset:0;background:#000;display:none}#cam video{width:100%;height:100%;object-fit:contain}
  #ov,#ed{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none}#ov{opacity:.35}
  #lines{position:absolute;inset:0;pointer-events:none}
  #bar{position:absolute;left:0;right:0;bottom:0;padding:10px;display:flex;gap:8px;flex-wrap:wrap;background:#000a}button{font:inherit;padding:8px 12px;border-radius:8px;border:0;background:#2a2d38;color:#fff}
  #cap{position:absolute;left:0;right:0;top:0;padding:8px 12px;background:#000a;font-size:13px}
  </style></head><body><header><h1>${esc(server().title)} · ${esc(server().episode)}</h1><small>${shots.length} shots. Tap one to line it up with your camera. Needs camera permission; works offline.</small></header>
  <div class="list" id="list"></div>
  <div id="cam"><video id="v" autoplay playsinline muted></video><img id="ov"><img id="ed"><div id="lines"></div><div id="cap"></div>
  <div id="bar"><button id="tOv">Frame</button><button id="tEd">Outline</button><button id="tLn">Lines</button><button id="prev">Prev</button><button id="next">Next</button><button id="close">Close</button></div></div>
  <script>
  const SHOTS=${JSON.stringify(shots).replace(/</g, "\\u003c")};let cur=0,stream=null,lines=${JSON.stringify(frameLines)};
  const $=(i)=>document.getElementById(i);
  $("list").innerHTML=SHOTS.map((s,i)=>'<div class="card" data-i="'+i+'"><img src="'+s.img+'"><div><b>'+s.id+' '+s.label+'</b><p>'+s.lens+'mm · '+s.move+' · '+s.light+' · '+s.dur.toFixed(1)+'s</p>'+(s.dialogue.length?'<p>'+s.dialogue.join('<br>')+'</p>':'')+'</div></div>').join("");
  function show(i){cur=(i+SHOTS.length)%SHOTS.length;const s=SHOTS[cur];$("ov").src=s.img;$("ed").src=s.edge||"";$("ed").style.display=s.edge?"":"none";$("cap").textContent=s.id+' '+s.label+' · '+s.lens+'mm · '+s.move;drawLines()}
  function drawLines(){const R={ "2.39":2.39,"1.85":1.85,"4:3":4/3,"9:16":9/16,"4:5":4/5};const r=R[lines];const el=$("lines");el.innerHTML="";if(!r)return;const W=innerWidth,H=innerHeight,fr=16/9;let bw=Math.min(W,H*fr),bh=bw/fr;let fw=bw,fh=bw/r;if(fh>bh){fh=bh;fw=bh*r}const x=(W-fw)/2,y=(H-fh)/2;const d=document.createElement("div");d.style.cssText="position:absolute;border:2px solid #f59a40;left:"+x+"px;top:"+y+"px;width:"+fw+"px;height:"+fh+"px";el.appendChild(d)}
  $("list").onclick=async(e)=>{const c=e.target.closest(".card");if(!c)return;$("cam").style.display="block";show(+c.dataset.i);try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});$("v").srcObject=stream}catch(err){$("cap").textContent="No camera access: "+err.message}};
  $("close").onclick=()=>{$("cam").style.display="none";stream&&stream.getTracks().forEach(t=>t.stop())};
  $("next").onclick=()=>show(cur+1);$("prev").onclick=()=>show(cur-1);
  $("tOv").onclick=()=>{$("ov").style.display=$("ov").style.display==="none"?"":"none"};$("tEd").onclick=()=>{$("ed").style.display=$("ed").style.display==="none"?"":"none"};
  $("tLn").onclick=()=>{const k=["none","2.39","1.85","4:3","9:16","4:5"];lines=k[(k.indexOf(lines)+1)%k.length];drawLines();$("cap").textContent+=' · lines '+lines};
  addEventListener("resize",drawLines);
  </script></body></html>`;
  download(`${projectName()}_${episodeName()}_shoot_pack.html`, html, "text/html");
  toast(`Shoot pack: ${shots.length} shots in one file. Open it on your phone (AirDrop or a file share).`);
});

E.wired("Storyboard", "Phone shoot pack");
