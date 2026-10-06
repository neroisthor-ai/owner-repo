// Dialogue clips (rendered by the server voice bank), the user's own voiceover track,
// the "Render voices" button and the writers' room.
const E = window.CrewExt;
const toast = (t, k = "info") => window.__crew?.toast(t, k);

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

// ---- the user's own voiceover ---------------------------------------------------------

let vo = null; // { buffer, name }
let rec = null; // active recording

E.vo = () => vo;
E.startVo = (m4, from, when) => {
  if (!vo || from >= vo.buffer.duration) return;
  const ctx = m4.ctx;
  const s = ctx.createBufferSource();
  s.buffer = vo.buffer;
  s.connect(m4.master);
  s.start(when, Math.max(0, from));
};
E.mixVo = (octx, dest, from, to) => {
  if (!vo || from >= vo.buffer.duration) return;
  const s = octx.createBufferSource();
  s.buffer = vo.buffer;
  s.connect(dest);
  s.start(0, from, Math.min(to - from, vo.buffer.duration - from));
};

async function setVoFromBlob(blob, name) {
  const buffer = await decoder().decodeAudioData(await blob.arrayBuffer());
  vo = { buffer, name };
  toast(`Voiceover "${name}" added (${buffer.duration.toFixed(1)}s). It plays with the cut and goes into renders. Lip-sync to a recording isn't built; characters keep their own dialogue timing.`);
}

E.on("Syncing a voiceover and lip-sync", ({ file }) => file && setVoFromBlob(file, file.name));

E.on("Recording a voiceover", async () => {
  if (rec) { rec.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't record audio.");
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { throw new Error("Microphone access was refused."); }
  const mr = new MediaRecorder(stream), parts = [];
  mr.ondataavailable = (e) => e.data.size && parts.push(e.data);
  mr.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    rec = null;
    try { await setVoFromBlob(new Blob(parts, { type: mr.mimeType }), "Recording"); } catch (e) { toast(`Couldn't read the recording: ${e.message}`, "error"); }
  };
  rec = mr;
  mr.start();
  toast("Recording. Click Record again to stop.");
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
  toast("Writers' room is breaking the script into shots...");
  const r = await api("POST", "/api/write", { script, apply: false });
  if (!r.ok) throw new Error(`The script didn't pass the checks: ${[r.error, ...(r.errors ?? []).map((x) => x.message ?? String(x))].filter(Boolean).slice(0, 3).join("; ") || "unknown"}`);
  const shots = (r.text.match(/^\d+[A-Z]+ /gm) ?? []).length;
  if (!window.confirm(`The writers' room made an episode of ${shots} shots.\n\nReplace the current episode with it?`)) return;
  await api("PUT", "/api/episode", { source: r.text });
  window.__crew.go("review");
  toast("Episode replaced.");
});

E.wired("Voice and captions");
