// The film renderer: a port of The Bob's renderFilm (library/reference/the_bob/index_master.html).
// One call renders one part (a range of shots) to an MP4:
//   - H.264 (hardware first), falling back to VP9; AAC, falling back to Opus
//   - passes per frame (accumulation), see look.js
//   - streamed muxing into chunks, so a long part never holds one giant buffer
//   - keyframe every 2 s, encoder back-pressure on the queue, yields via MessageChannel so it keeps
//     full speed in a background tab, screen wake lock, WebGL context-loss detection
import { Muxer, StreamTarget } from "/vendor/mp4-muxer/mp4-muxer.mjs";
import * as Look from "./look.js";
import * as Reframe from "./reframe.js";

// yield to the event loop without timers: keeps running at full speed when the tab is in the background
const yieldNow = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

export function webCodecsOk() {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined"
    ? { ok: true }
    : { ok: false, reason: "This browser has no WebCodecs (VideoEncoder). Use a recent Chrome, Edge or Safari." };
}

/** The Bob's video encoder choice: H.264 with hardware first, then software, then VP9. */
export async function pickVideoConfig(W, H, FPS) {
  const avc = (codec, hw) => ({ codec, width: W, height: H, bitrate: Math.min(30e6, Math.round(W * H * 24 * 0.14)), framerate: FPS, avc: { format: "avc" }, ...(hw ? { hardwareAcceleration: "prefer-hardware" } : {}) });
  const tries = [
    ["avc", avc("avc1.640033", true)], ["avc", avc("avc1.640033", false)],
    ["avc", avc("avc1.640028", false)], ["avc", avc("avc1.4d0028", false)], ["avc", avc("avc1.42001f", false)],
    ["vp9", { codec: "vp09.00.51.08", width: W, height: H, bitrate: Math.min(25e6, Math.round(W * H * 24 * 0.12)), framerate: FPS }],
  ];
  for (const [muxCodec, cfg] of tries) {
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, muxCodec }; } catch {}
  }
  throw new Error(`No video encoder is available at ${W}×${H} in this browser. Try a smaller size.`);
}

/** AAC if the browser has it, else Opus. */
export async function pickAudioConfig(sampleRate) {
  if (typeof AudioEncoder === "undefined") return null;
  for (const [codec, muxCodec] of [["mp4a.40.2", "aac"], ["opus", "opus"]]) {
    const cfg = { codec, sampleRate, numberOfChannels: 2, bitrate: 256000 };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, muxCodec }; } catch {}
  }
  return null;
}

/**
 * Render baked[range.start .. range.end] to MP4.
 *   opts  { width, height, fps, burn, passes }
 *   extra { signal, assets, onProgress(done, total, { passes }), maxFrames }
 * -> { blob, frames, ms, bytes, codec, audio }
 */
export async function renderPart(baked, range, opts, extra = {}) {
  const ok = webCodecsOk();
  if (!ok.ok) throw new Error(ok.reason);
  const X = window.__crew;
  const W = opts.width, H = opts.height, FPS = opts.fps;
  const SPP = Math.max(1, (opts.passes ?? Look.settings.spp) | 0);
  const t0 = performance.now();
  const total = Math.max(1, Math.min(extra.maxFrames ?? Infinity, Math.round((range.end - range.start) * FPS)));
  const { cfg: vcfg, muxCodec } = await pickVideoConfig(W, H, FPS);

  // audio is mixed for the whole part up front (the app's own mixer, rendered offline) and encoded in 1 s blocks
  const aEnd = range.start + total / FPS;
  const hasAudio = (baked.audio?.length ?? 0) > 0 && typeof OfflineAudioContext !== "undefined";
  const acfgPick = hasAudio ? await pickAudioConfig(48000) : null;

  let wake = null;
  try { wake = await navigator.wakeLock?.request("screen"); } catch {}
  const onVis = async () => { if (document.visibilityState === "visible") { try { wake = await navigator.wakeLock?.request("screen"); } catch {} } };
  document.addEventListener("visibilitychange", onVis);

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  let glLost = false;
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); glLost = true; });
  const viewer = new X.Viewer(canvas);
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const o2 = out.getContext("2d");

  // streamed muxing: chunks arrive with their file position; the muxer patches earlier ranges, so keep them addressable
  const parts = [];
  let endPos = 0;
  const target = new StreamTarget({
    chunked: true, chunkSize: 8 * 1048576,
    onData: (data, pos) => {
      const b = new Blob([data.slice()]);
      if (pos >= endPos) { parts.push({ pos, len: data.byteLength, b }); endPos = pos + data.byteLength; }
      else for (const pt of parts) if (pos >= pt.pos && pos + data.byteLength <= pt.pos + pt.len) { const o = pos - pt.pos; pt.b = new Blob([pt.b.slice(0, o), b, pt.b.slice(o + data.byteLength)]); break; }
    },
  });
  const muxer = new Muxer({ target, video: { codec: muxCodec, width: W, height: H, frameRate: FPS }, audio: acfgPick ? { codec: acfgPick.muxCodec, numberOfChannels: 2, sampleRate: 48000 } : undefined, fastStart: false, firstTimestampBehavior: "offset" });
  let encErr = null;
  const venc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: (e) => { encErr = e; } });
  venc.configure(vcfg);
  let audioDone = false;

  try {
    viewer.assets = extra.assets ?? null;
    viewer.setFixedSize([W, H]);
    viewer.load(baked);
    await viewer.ready();
    const bg = opts.background ?? "scene";
    viewer.lookOn = bg === "scene"; // a green screen or a matte is flat colour: no film look on it
    viewer.lookSpp = SPP;
    if (bg === "green") { viewer.noSets = true; viewer.bgOverride = "#00ff00"; }
    const cropping = Reframe.setup(viewer, W, H), rf = {};

    if (acfgPick) {
      const buf = await X.mixAudio(baked, range.start, aEnd, 48000);
      const aenc = new AudioEncoder({ output: (ch, meta) => muxer.addAudioChunk(ch, meta), error: (e) => { encErr = e; } });
      aenc.configure(acfgPick.cfg);
      const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L, sr = buf.sampleRate, blk = sr;
      for (let i = 0; i < L.length; i += blk) {
        const n = Math.min(blk, L.length - i), data = new Float32Array(n * 2);
        data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
        const ad = new AudioData({ format: "f32-planar", sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / sr) * 1e6), data });
        aenc.encode(ad); ad.close();
      }
      await aenc.flush(); aenc.close();
      audioDone = true;
    }

    for (let f = 0; f < total; f++) {
      if (extra.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
      if (encErr) throw encErr;
      if (glLost) throw new Error("The graphics card reset (WebGL context lost).");
      const t = Math.min(range.start + f / FPS, Math.max(0, baked.duration - 1e-4));
      if (cropping) Reframe.follow(viewer, baked, t, opts.reframe, W, rf);
      if (SPP > 1 && viewer.lookOn) {
        // accumulation passes: pose the world, then render with a yield between motion-blur time slices
        const info = Look.infoAt(baked, t);
        viewer._noDraw = true; viewer.frame(t); viewer._noDraw = false;
        viewer._inLook = true;
        try { await Look.renderAsync(viewer, info, yieldNow); } finally { viewer._inLook = false; }
      } else viewer.frame(t); // single pass: real-time look
      o2.drawImage(canvas, 0, 0, W, H);
      X.burn(o2, W, H, t, baked, opts);
      window.CrewExt?.overlay?.(o2, W, H, t, baked, opts);
      await window.CrewExt?.overlayUser?.(o2, W, H, t);
      const vf = new VideoFrame(out, { timestamp: Math.round((f * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      venc.encode(vf, { keyFrame: f % (FPS * 2) === 0 }); vf.close();
      while (venc.encodeQueueSize > 4) await new Promise((r) => { let d = false; const fin = () => { if (!d) { d = true; r(); } }; venc.addEventListener("dequeue", fin, { once: true }); setTimeout(fin, 50); });
      if (f % 3 === 0 || f === total - 1) extra.onProgress?.(f + 1, total, { passes: viewer.look?.last?.n ?? 1 });
      if (f % 2 === 0) await yieldNow();
    }
    await venc.flush();
    if (encErr) throw encErr;
    venc.close();
    muxer.finalize();
  } finally {
    try { wake?.release(); } catch {}
    document.removeEventListener("visibilitychange", onVis);
    try { Look.disposeLook(viewer); } catch {}
    viewer.dispose(true);
    try { if (venc.state !== "closed") venc.close(); } catch {}
  }
  parts.sort((a, b) => a.pos - b.pos);
  const blob = new Blob(parts.map((p) => p.b), { type: "video/mp4" });
  return { blob, frames: total, ms: performance.now() - t0, bytes: blob.size, codec: vcfg.codec, audio: audioDone };
}
