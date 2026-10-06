// Hand off to editorial: OpenTimelineIO, EDL, Final Cut XML, per-shot clips, and comparing an editor's cut.
import { baked, server, download, toast, tick, projectName, episodeName, clipPlan, edl, fcpxml, patchOtio, parseEdl, parseOtio, compareCuts, zipStore, shotsOf, esc } from "./util.js";

const E = window.CrewExt;
const X = () => window.__crew;

const plansFor = (ctx) => {
  const b = baked();
  return { b, plans: clipPlan(b.shots, b.fps, ctx.handles ?? 0, b.duration, { keepIds: ctx.takeLetters !== false }) };
};
const base = () => `${projectName()}_${episodeName()}`;

E.on("EDL export", (ctx) => {
  const { b, plans } = plansFor(ctx);
  download(`${base()}.edl`, edl(server().title, b.fps, plans), "text/plain");
  toast(`EDL: ${plans.length} events, clips named ${plans[0]?.name ?? "shot"}.mp4, handles ${ctx.handles ?? 0} frames. Pair it with "Clips per shot".`);
});

E.on("Final Cut XML export", (ctx) => {
  const { b, plans } = plansFor(ctx);
  download(`${base()}.xml`, fcpxml(server().title, b.fps, plans, { width: 1280, height: 720 }), "application/xml");
  toast(`Final Cut XML: ${plans.length} clips on one video track, pointing at ${plans[0]?.name ?? "shot"}.mp4 and the rest.`);
});

E.on("OpenTimelineIO export", async (ctx) => {
  const { b, plans } = plansFor(ctx);
  const otio = await X().api.otio();
  download(`${base()}.otio`, JSON.stringify(patchOtio(otio, plans, b.fps), null, 2), "application/json");
  toast(`OpenTimelineIO: ${plans.length} clips with handles, dialogue on its own track.`);
});

/** Render each shot to its own MP4, with handles, and zip them. Used by Hand off to editorial and Create. */
async function clipsZip(ctx, { tag = "clips" } = {}) {
  const b = baked(), fps = b.fps, plans = clipPlan(b.shots, fps, ctx.handles ?? 0, b.duration, { keepIds: ctx.takeLetters !== false });
  if (!E.renderPart) throw new Error("The film renderer isn't loaded.");
  if (ctx.background === "alpha") throw new Error("MP4 can't carry transparency. Use 'PNG sequence' with Transparent (characters only), or pick Green screen.");
  if (ctx.background === "blur") throw new Error("A blurred set needs a transparent layer, which MP4 can't hold. Use the PNG sequence, or pick Keep the set or Green screen.");
  const files = [];
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i];
    toast(`Rendering clip ${i + 1} of ${plans.length} (${p.name})...`);
    await tick();
    const start = (p.recIn - p.lead) / fps, end = (p.recOut + p.tail) / fps;
    const r = await E.renderPart(b, { start, end }, { width: ctx.width ?? 1280, height: ctx.height ?? 720, fps, burn: { timecode: false, shot: false, subs: false }, passes: ctx.passes, background: ctx.background }, { assets: server().assets });
    files.push({ name: `${p.name}.mp4`, data: new Uint8Array(await r.blob.arrayBuffer()) });
  }
  download(`${base()}_${tag}.zip`, new Blob([zipStore(files)], { type: "application/zip" }));
  toast(`${files.length} clips in a zip, ${ctx.handles ?? 0} frames of handles each. Names match the EDL and XML.`);
}
E.clipsZip = clipsZip;
E.on("Per-shot clip export", (ctx) => (ctx.handles !== undefined ? clipsZip(ctx) : clipsZip({ ...ctx, handles: 0, takeLetters: true }, { tag: "shots" })));

// ---- compare with the editor's cut ---------------------------------------------------------

function pickFile(accept) {
  return new Promise((ok) => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = accept; i.style.display = "none";
    i.onchange = () => { ok(i.files?.[0] ?? null); i.remove(); };
    i.oncancel = () => { ok(null); i.remove(); };
    document.body.appendChild(i); i.click();
  });
}

E.on("Checking a cut against the editor's timeline", async (ctx) => {
  const f = await pickFile(".edl,.otio,.json,text/plain");
  if (!f) return;
  const b = baked(), fps = b.fps, text = await f.text();
  let events;
  try { events = /^\s*\{/.test(text) ? parseOtio(JSON.parse(text), fps) : parseEdl(text, fps); } catch { throw new Error("That isn't an EDL or an OpenTimelineIO file."); }
  if (!events.length) throw new Error("Found no clips in that file.");
  const plans = clipPlan(b.shots, fps, 0, b.duration, { keepIds: true });
  const { rows, unmatched } = compareCuts(plans, events);
  const sec = (n) => (n == null ? "dropped" : `${(n / fps).toFixed(2)}s`);
  const changed = rows.filter((r) => r.diff !== 0);
  const html = `<div style="position:fixed;inset:0;background:#000a;z-index:99999;display:grid;place-items:center" id="crew-cmp"><div style="background:#12141b;color:#e8e8ee;border:1px solid #333;border-radius:12px;padding:18px;max-width:560px;width:92%;max-height:80vh;overflow:auto;font:13px system-ui">
    <h3 style="margin:0 0 6px">Your cut against the editor's</h3>
    <p style="margin:0 0 10px;color:#9aa">${changed.length ? `${changed.length} of ${rows.length} shots changed length or were dropped.` : "Every shot matches."}${unmatched.length ? ` ${unmatched.length} clip${unmatched.length > 1 ? "s" : ""} in the editor's timeline match no shot (${esc(unmatched.slice(0, 4).join(", "))}).` : ""}</p>
    <table style="width:100%;border-collapse:collapse">${rows.map((r) => `<tr style="border-top:1px solid #2a2d38"><td style="padding:3px 6px">${esc(r.id)}</td><td>${sec(r.ours)}</td><td>${sec(r.theirs)}</td><td style="color:${r.diff ? (r.diff < 0 ? "#f59a40" : "#7bd") : "#6a6"}">${r.diff == null ? "" : r.diff === 0 ? "same" : (r.diff > 0 ? "+" : "") + (r.diff / fps).toFixed(2) + "s"}</td></tr>`).join("")}</table>
    <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end"><button id="crew-cmp-x" style="padding:6px 12px">Close</button><button id="crew-cmp-go" style="padding:6px 12px;background:#f59a40;border:0;border-radius:6px" ${changed.some((r) => r.diff) ? "" : "disabled"}>Match my cut to theirs</button></div>
  </div></div>`;
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  const close = () => host.remove();
  host.querySelector("#crew-cmp-x").onclick = close;
  host.querySelector("#crew-cmp-go").onclick = async () => {
    close();
    // shorter in the editor's cut: trim the tail; longer: hold the last frame. Editor-role patch, checked before it is applied.
    const ops = changed.filter((r) => r.diff).map((r) => (r.diff < 0 ? `${r.id} + trim 0 ${(-r.diff / fps).toFixed(2)}` : `${r.id} + hold ${(r.diff / fps).toFixed(2)}`));
    if (!ops.length) return;
    const patch = ops.join("\n");
    try {
      const dry = await X().api.patch(patch, "editor", true);
      if (!dry.ok) throw new Error(dry.reasons?.join("; ") ?? "the editor role can't make those changes");
      await X().api.patch(patch, "editor", false);
      toast(`Matched ${ops.length} shot${ops.length > 1 ? "s" : ""} to the editor's cut. Undo restores yours.`);
    } catch (e) { toast(`Couldn't match the cut: ${e.message}`, "error"); }
  };
});

E.wired("Hand off to editorial");
