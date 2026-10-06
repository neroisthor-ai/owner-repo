// Dialogue clips (rendered by the server voice bank), the user's own voiceover track,
// the "Render voices" button and the writers' room.
const E = window.CrewExt;
const toast = (t, k = "info") => window.__crew?.toast(t, k);
const X = () => window.__crew;

// ---- rendered clips -------------------------------------------------------------------

const decoder = () => new OfflineAudioContext(1, 1, 48000);
const clips = new Map(); // url -> AudioBuffer | null (null = failed)
const pending = new Map();

function load(url) {
  if (clips.has(url)) return Promise.resolve(clips.get(url));
  if (!pending.has(url)) {
    pending.set(url, fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => decoder().decodeAudioData(b))
      .catch(() => null)
      .then((b) => { clips.set(url, b); pending.delete(url); return b; }));
  }
  return pending.get(url);
}

E.clipBuffer = (url) => (url ? clips.get(url) ?? null : null);
E.preloadClips = (events) => Promise.all((events ?? []).filter((e) => e.type === "say" && e.src).map((e) => load(e.src)));

/** Play one dialogue clip now through the live audio engine. Returns true when it took over from browser TTS. */
E.playClip = (m4, ev, fallback) => {
  if (!ev.src) return false;
  const ctx = m4.ensure();
  if (!ctx || !m4.master) return false;
  load(ev.src).then((buf) => {
    if (!m4.playing) return;
    if (!buf) return fallback();
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.connect(m4.master);
    s.start(ctx.currentTime + 0.01);
  });
  return true;
};

// ---- waveforms on the dialogue track -------------------------------------------------------------------------------

const waves = new Map();
/** A data URL of the clip's waveform (mirrored bars), or null while the clip is still loading. */
E.waveSrc = (ev) => {
  if (!ev.src) return null;
  if (waves.has(ev.src)) return waves.get(ev.src);
  if (clips.has(ev.src) && !clips.get(ev.src)) return null; // failed to load: no waveform, and no retry loop
  const buf = clips.get(ev.src);
  if (!buf) {
    if (!pending.has(ev.src)) load(ev.src).then((b) => { if (!b) return; const st = X().store; st.set({ waveRev: (st.get().waveRev ?? 0) + 1 }); });
    return null;
  }
  const W = 480, H = 40, c = document.createElement("canvas"), g = c.getContext("2d"), d = buf.getChannelData(0), step = Math.max(1, Math.floor(d.length / W));
  c.width = W; c.height = H;
  g.fillStyle = "rgba(235,255,245,.9)";
  for (let x = 0; x < W; x++) {
    let m = 0;
    for (let i = x * step; i < Math.min(d.length, (x + 1) * step); i += 8) m = Math.max(m, Math.abs(d[i]));
    const h = Math.max(1, Math.min(1, m * 1.6) * (H - 6));
    g.fillRect(x, (H - h) / 2, 1, h);
  }
  const url = c.toDataURL("image/png");
  waves.set(ev.src, url);
  return url;
};

// ---- recording a voiceover: it lands on the timeline as a clip on "Your audio" (media.js owns editing it) ---------------

let rec = null; // active recording

E.on("Recording a voiceover", async () => {
  if (rec) { rec.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't record audio.");
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { throw new Error("Microphone access was refused."); }
  const mr = new MediaRecorder(stream), parts = [], at = X().clock.t;
  mr.ondataavailable = (e) => e.data.size && parts.push(e.data);
  mr.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    rec = null;
    try { await E.editApi.importBlob(new Blob(parts, { type: mr.mimeType }), `Voiceover ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.webm`, { t: at, track: "A3" }); toast("Voiceover placed on Your audio."); }
    catch (e) { toast(`Couldn't read the recording: ${e.message}`, "error"); }
  };
  rec = mr;
  mr.start();
  toast("Recording from the playhead. Click Record again to stop.");
});

// ---- server: voices and writers' room -------------------------------------------------

async function api(method, url, body) {
  const demo = window.__crew.demo();
  if (demo) throw new Error("This needs the Crew server (npm start). You're on the built-in demo.");
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error ?? r.statusText);
  return j;
}
E.serverApi = api;

E.on("Rendering voices", async ({ force } = {}) => {
  toast("Rendering voices. Progress is in the crew log.");
  const r = await api("POST", "/api/voices", { force: !!force });
  const fail = r.failed?.length ? `, ${r.failed.length} failed` : "";
  toast(`Voices: ${r.made} rendered, ${r.cached} cached${fail} (${r.engine}). Cut ${r.durationBefore.toFixed(1)}s to ${r.durationAfter.toFixed(1)}s.`);
});

E.on("Breaking a script into shots", async ({ script }) => {
  if (!script?.trim()) return;
  E.checkSetDraft?.();
  toast("Writers' room is breaking the script into shots...");
  const r = await api("POST", "/api/write", { script, apply: false });
  if (!r.ok) throw new Error(`The script didn't pass the checks: ${[r.error, ...(r.errors ?? []).map((x) => x.message ?? String(x))].filter(Boolean).slice(0, 3).join("; ") || "unknown"}`);
  const shots = (r.text.match(/^\d+[A-Z]+ /gm) ?? []).length;
  if (!window.confirm(`The writers' room made an episode of ${shots} shots.\n\nReplace the current episode with it?`)) return;
  await api("PUT", "/api/episode", { source: r.text });
  await E.applySetDraft?.().catch((e) => toast(`Couldn't read the set pictures: ${e.message}`, "error"));
  window.__crew.go("review");
  toast("Episode replaced.");
});

E.wired("Voice and captions");

// load the dialogue clips as soon as a cut arrives, so the waveforms are on the timeline before anyone presses play
const waitStore = setInterval(() => {
  if (!X()?.store) return;
  clearInterval(waitStore);
  let last = null;
  X().store.subscribe(() => {
    const b = X().store.get().server?.baked;
    if (!b || b === last) return;
    last = b;
    E.preloadClips(b.audio).then(() => { const st = X().store; st.set({ waveRev: (st.get().waveRev ?? 0) + 1 }); });
  });
}, 150);
