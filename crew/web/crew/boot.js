// Loads the add-on modules, then the app bundle. Every module is optional: a failure
// here never stops the app from starting (the bundle falls back to its own behaviour).
const ext = (window.CrewExt = window.CrewExt ?? {
  handlers: {},
  wiredSections: new Set(),
  /** register a handler for a button the bundle used to stub out */
  on(what, fn) { ext.handlers[what] = fn; },
  /** mark Deliver/Create sections as fully wired (hides their "not wired" badge) */
  wired(...titles) { titles.forEach((t) => ext.wiredSections.add(t)); },
});

const MODULES = ["props", "voice", "exports/camera", "exports/storyboard", "exports/shotlist", "exports/editorial", "exports/media", "create", "style"];
await Promise.all(MODULES.map(async (m) => {
  try { await import(`/crew/${m}.js`); } catch (e) { if (!String(e?.message).includes("Failed to fetch dynamically")) console.warn(`[crew] module ${m} not loaded:`, e); }
}));
await import("/app.js");
