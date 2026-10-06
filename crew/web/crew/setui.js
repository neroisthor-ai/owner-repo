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
  clear(); draft.mode = "3d"; bump();
  return true;
};
E.checkSetDraft = () => { if (draft.mode === "2d" && !draft.files.length) throw new Error("Add a backdrop picture for the 2D set, or switch to a 3D set."); };

E.ui = Object.assign(E.ui ?? {}, { SetChoice });
