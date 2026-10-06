// New-project set choice on Home: a 3D set (shaped by inspiration images you add) or a 2D backdrop (one picture behind the action).
// The choice is a draft until the writers' room makes the episode, then it is stored for the project (setlook.js applies it).
const E = window.CrewExt;
const X = () => window.__crew;
const h = (...a) => X().react.createElement(...a);

const draft = (E.setDraft = { mode: "3d", files: [], urls: [], rev: 0, subs: new Set() });
const bump = () => { draft.rev++; draft.subs.forEach((f) => f()); };
const useDraft = () => X().react.useSyncExternalStore((f) => { draft.subs.add(f); return () => draft.subs.delete(f); }, () => draft.rev);
const MAX = { "3d": 6, "2d": 1 };

function add(files) {
  const imgs = [...files].filter((f) => f.type.startsWith("image/"));
  if (!imgs.length) return X().toast("Those aren't pictures this browser can read.", "error");
  const room = MAX[draft.mode] - draft.files.length;
  if (draft.mode === "2d") { draft.urls.forEach(URL.revokeObjectURL); draft.files = []; draft.urls = []; }
  for (const f of imgs.slice(0, draft.mode === "2d" ? 1 : Math.max(0, room))) { draft.files.push(f); draft.urls.push(URL.createObjectURL(f)); }
  bump();
}
const clear = () => { draft.urls.forEach(URL.revokeObjectURL); draft.files = []; draft.urls = []; bump(); };

export function SetChoice() {
  useDraft();
  const input = X().react.useRef(null), is3 = draft.mode === "3d";
  const seg = (v, label, tip) => h("button", { type: "button", className: "sc-seg" + (draft.mode === v ? " on" : ""), title: tip, onClick: () => { if (draft.mode !== v) { draft.mode = v; if (v === "2d" && draft.files.length > 1) { draft.files.length = 1; draft.urls.slice(1).forEach(URL.revokeObjectURL); draft.urls.length = 1; } bump(); } } }, label);
  return h("div", { className: "sc", "data-testid": "set-choice" },
    h("span", { className: "sc-label" }, "Set"),
    h("div", { className: "sc-segs", role: "radiogroup", "aria-label": "Set type" },
      seg("3d", "3D set", "A room or street built in 3D, with your pictures as inspiration"),
      seg("2d", "2D backdrop", "One picture behind the action, like a painted flat")),
    h("input", { ref: input, type: "file", accept: "image/*", multiple: is3, hidden: true, onChange: (e) => { const f = [...e.target.files]; e.target.value = ""; f.length && add(f); } }),
    h("div", { className: "sc-chips" },
      draft.urls.map((u, i) => h("span", { key: u, className: "sc-chip", style: { backgroundImage: `url(${u})` }, title: draft.files[i]?.name },
        h("button", { type: "button", "aria-label": "Remove picture", onClick: () => { URL.revokeObjectURL(u); draft.files.splice(i, 1); draft.urls.splice(i, 1); bump(); } }, "×"))),
      draft.files.length < MAX[draft.mode] && h("button", { type: "button", className: "sc-add", onClick: () => input.current?.click() }, draft.files.length ? "Add another" : is3 ? "Add inspiration pictures" : "Add backdrop picture")),
    h("span", { className: "sc-hint" }, is3 ? "Colours, light and mood are taken from your pictures." : "The picture sits behind the actors and the camera moves over it."));
}

/** Called by the script handler once the episode exists: stores the look for the project, then clears the draft. */
E.applySetDraft = async () => {
  if (!draft.files.length) { draft.mode = "3d"; bump(); return false; }
  const st = X().store.get().server, key = `${st.title}|${st.episode}`;
  const reads = await E.readImages(draft.files);
  const look = E.mergeLooks(reads.map((r) => r.look));
  const backdrop = draft.mode === "2d" ? await E.makeBackdrop(draft.files[0]) : null;
  E.setLook.set(key, { mode: draft.mode, look, thumbs: reads.map((r) => r.thumb), backdrop });
  X().toast(draft.mode === "2d" ? "Backdrop set. It sits behind the action in every shot." : `Set shaped by ${reads.length} picture${reads.length === 1 ? "" : "s"}: ${look?.mood ?? "neutral"} light, ${Math.round((look?.brightness ?? 0.5) * 100)}% bright.`);
  const files = [...draft.files], mode = draft.mode;
  clear(); draft.mode = "3d"; bump();
  // with Crew AI on, the director also looks at the pictures and proposes a layout for the set
  if (mode === "3d" && st.mode && st.mode !== "offline") proposeLayout(files).catch((e) => X().toast(`Couldn't lay the set out from your pictures: ${e.message}`, "error"));
  return true;
};

const shrink = (file, max = 1024) => new Promise((res, rej) => {
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.85)); };
  img.onerror = () => rej(new Error(`can't read ${file.name}`));
  img.src = url;
});

async function proposeLayout(files) {
  X().toast("The director is laying out the set from your pictures. This takes a minute.");
  const images = await Promise.all(files.map((f) => shrink(f)));
  const r = await fetch("/api/set-layout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ images }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  showProposal(j);
}

/** A small sheet: the proposed set beside the current one; nothing changes until "Use this layout". */
function showProposal(p) {
  document.querySelector(".sl-sheet")?.remove();
  const el = document.createElement("div");
  el.className = "sl-sheet";
  el.innerHTML = `<div class="sl-card" role="dialog" aria-label="Set layout from your pictures">
    <h3>Set layout from your pictures</h3>
    <p>${p.ok ? `The director laid out <b>${p.setId}</b> from your pictures and kept every mark the episode uses.` : `The director's layout still has problems, so it can't be used: ${(p.problems ?? [p.error]).slice(0, 2).join(" ")}`}</p>
    <div class="sl-cols"><div><small>Now</small><pre></pre></div><div><small>Proposed</small><pre></pre></div></div>
    <div class="sl-actions"><button class="xe-btn" data-k="keep">Keep the current set</button>${p.ok ? '<button class="xe-btn accent" data-k="use">Use this layout</button>' : ""}</div></div>`;
  const pres = el.querySelectorAll("pre");
  pres[0].textContent = p.current || "(none)";
  pres[1].textContent = p.block || "";
  el.addEventListener("click", async (e) => {
    const k = e.target.closest?.("button")?.dataset.k;
    if (e.target === el || k === "keep") el.remove();
    if (k === "use") {
      const r = await fetch("/api/set-layout/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ setId: p.setId, block: p.block }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return X().toast(j.error ?? "Couldn't use the layout.", "error");
      el.remove();
      X().toast("New set layout in place. Every shot re-renders with it.", "ok");
    }
  });
  document.body.appendChild(el);
}
E.checkSetDraft = () => { if (draft.mode === "2d" && !draft.files.length) throw new Error("Add a backdrop picture for the 2D set, or switch to a 3D set."); };

E.ui = Object.assign(E.ui ?? {}, { SetChoice });
