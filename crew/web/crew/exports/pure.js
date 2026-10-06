// DOM-free helpers for the exports: timecode, CSV, SRT, chapters, EDL, FCP XML, zip, rotation maths.
// Kept free of browser APIs so test/web-exports.test.ts can run them in Node.

const pad = (n, w = 2) => String(Math.trunc(n)).padStart(w, "0");

/** HH:MM:SS:FF at an integer frame rate. */
export function tc(seconds, fps) {
  const total = Math.round(Math.max(0, seconds) * fps);
  const f = total % fps, s = Math.floor(total / fps);
  return `${pad(s / 3600)}:${pad((s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
}
export const frames = (seconds, fps) => Math.round(Math.max(0, seconds) * fps);

export function csv(rows) {
  const cell = (v) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function srtTime(t) {
  const ms = Math.round(Math.max(0, t) * 1000);
  return `${pad(ms / 3600000)}:${pad((ms / 60000) % 60)}:${pad((ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}
/** events: [{t, dur, char?, text}] in cut time. */
export function srt(events) {
  return events.map((e, i) => `${i + 1}\n${srtTime(e.t)} --> ${srtTime(e.t + e.dur)}\n${e.text}\n`).join("\n");
}

/** YouTube chapters from [{t, title}]. Returns { text, warnings }. */
export function chapters(list) {
  const mmss = (t) => { const s = Math.round(t); return s >= 3600 ? `${Math.floor(s / 3600)}:${pad((s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`; };
  const rows = list.map((c, i) => ({ t: i === 0 ? 0 : c.t, title: c.title }));
  const warnings = [];
  if (rows.length < 3) warnings.push("YouTube needs at least 3 chapters.");
  rows.forEach((r, i) => { if (i + 1 < rows.length && rows[i + 1].t - r.t < 10) warnings.push(`Chapter "${r.title}" is under 10 seconds; YouTube ignores chapters that short.`); });
  return { text: rows.map((r) => `${mmss(r.t)} ${r.title}`).join("\n") + "\n", warnings };
}

/**
 * Per-shot clip plan with handles: the exported clip for a shot starts `lead` frames before the cut
 * (clamped at the start of the film) and ends `tail` frames after it (clamped at the end).
 * shots: [{id, label, cutStart, cutDur}], returns frame numbers at fps.
 */
export function clipPlan(shots, fps, handles = 0, duration = Infinity, { keepIds = true } = {}) {
  const end = frames(duration, fps);
  return shots.map((s, i) => {
    const recIn = frames(s.cutStart, fps), len = Math.max(1, frames(s.cutDur, fps));
    const lead = Math.min(handles, recIn), tail = Math.min(handles, Math.max(0, end - (recIn + len)));
    return { id: s.id, name: keepIds ? s.id : `shot_${pad(i + 1, 3)}`, label: s.label ?? "", recIn, recOut: recIn + len, lead, tail, srcIn: lead, srcOut: lead + len, clipLen: lead + len + tail };
  });
}
export const clipName = (plan) => plan.name ?? plan.id;

/** CMX 3600 EDL: one cut event per shot, the source being that shot's exported clip. */
export function edl(title, fps, plans) {
  const out = [`TITLE: ${title}`, "FCM: NON-DROP FRAME", ""];
  plans.forEach((p, i) => {
    const t = (n) => tc(n / fps, fps);
    out.push(`${pad(i + 1, 3)}  ${clipName(p).replace(/[^A-Za-z0-9]/g, "").slice(0, 8).padEnd(8)} V     C        ${t(p.srcIn)} ${t(p.srcOut)} ${t(p.recIn)} ${t(p.recOut)}`);
    out.push(`* FROM CLIP NAME: ${clipName(p)}.mp4`);
    if (p.label) out.push(`* COMMENT: ${p.label}`);
    out.push("");
  });
  return out.join("\n");
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** Final Cut Pro 7 XML (xmeml v5): one clipitem per shot clip. */
export function fcpxml(title, fps, plans, { width = 1280, height = 720 } = {}) {
  const total = plans.length ? plans[plans.length - 1].recOut : 0;
  const rate = `<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`;
  const items = plans.map((p, i) => `
          <clipitem id="clipitem-${i + 1}">
            <name>${esc(clipName(p))}</name>
            <duration>${p.clipLen}</duration>
            ${rate}
            <start>${p.recIn}</start>
            <end>${p.recOut}</end>
            <in>${p.srcIn}</in>
            <out>${p.srcOut}</out>
            <file id="file-${i + 1}">
              <name>${esc(clipName(p))}.mp4</name>
              <pathurl>${esc(clipName(p))}.mp4</pathurl>
              ${rate}
              <duration>${p.clipLen}</duration>
              <media><video><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height></samplecharacteristics></video></media>
            </file>
          </clipitem>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence id="sequence-1">
    <name>${esc(title)}</name>
    <duration>${total}</duration>
    ${rate}
    <media>
      <video>
        <format><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height></samplecharacteristics></format>
        <track>${items}
        </track>
      </video>
    </media>
  </sequence>
</xmeml>
`;
}

// ---- zip (STORE only, no compression) -------------------------------------------------

let CRC_TABLE = null;
export function crc32(u8) {
  if (!CRC_TABLE) { CRC_TABLE = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** files: [{name, data: Uint8Array}] -> Uint8Array of a .zip (stored, UTF-8 names). */
export function zipStore(files) {
  const enc = new TextEncoder(), chunks = [], central = [];
  let offset = 0;
  const u16 = (v) => [v & 255, (v >> 8) & 255], u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const local = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0)]);
    chunks.push(local, name, f.data);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + size;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

// ---- rotations (three.js world: Y up, camera looks down -Z) ---------------------------

export const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const D = 180 / Math.PI;
/** Euler angles in degrees for rotation order Y then X then Z (Nuke's "ZXY"), from a quaternion [x,y,z,w]. Same as three.js Euler "YXZ". */
export function eulerZXY(q) {
  const [x, y, z, w] = q;
  const m23 = 2 * (y * z - x * w);
  const rx = Math.asin(Math.max(-1, Math.min(1, -m23)));
  let ry, rz;
  if (Math.abs(m23) < 0.9999999) {
    ry = Math.atan2(2 * (x * z + y * w), 1 - 2 * (x * x + y * y));
    rz = Math.atan2(2 * (x * y + z * w), 1 - 2 * (x * x + z * z));
  } else {
    ry = Math.atan2(-2 * (x * z - y * w), 1 - 2 * (y * y + z * z));
    rz = 0;
  }
  return [rx * D, ry * D, rz * D];
}
/** three world -> Blender world: (x, y, z) -> (x, -z, y), a +90 degree turn about X. */
export const toBlenderPos = (p) => [p[0], -p[2], p[1]];
const Q90X = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
export const toBlenderQuat = (q) => qmul(Q90X, q); // [x,y,z,w]
/** vertical fov (degrees) -> focal length (mm) on a sensor of the given height. */
export const focalFromFov = (fov, sensorH = 24) => (sensorH / 2) / Math.tan((fov * Math.PI) / 360);

// ---- reading and rewriting editorial files ---------------------------------------------------

const tcToFrames = (s, fps) => { const [h, m, sec, f] = s.split(/[:;]/).map(Number); return ((h * 60 + m) * 60 + sec) * fps + f; };

/** Events from a CMX 3600 EDL: [{ name, srcIn, srcOut, recIn, recOut }] in frames. */
export function parseEdl(text, fps) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(\d{3,})\s+\S+\s+\S+\s+\S+\s+(\d\d[:;]\d\d[:;]\d\d[:;]\d\d)\s+(\d\d[:;]\d\d[:;]\d\d[:;]\d\d)\s+(\d\d[:;]\d\d[:;]\d\d[:;]\d\d)\s+(\d\d[:;]\d\d[:;]\d\d[:;]\d\d)/);
    if (!m) continue;
    let name = "";
    for (let j = i + 1; j < Math.min(lines.length, i + 4) && !/^\s*\d{3,}\s/.test(lines[j]); j++) {
      const n = lines[j].match(/\*\s*FROM CLIP NAME:\s*(.+)$/i); if (n) name = n[1].trim();
    }
    out.push({ name: name.replace(/\.[A-Za-z0-9]+$/, ""), srcIn: tcToFrames(m[2], fps), srcOut: tcToFrames(m[3], fps), recIn: tcToFrames(m[4], fps), recOut: tcToFrames(m[5], fps) });
  }
  return out;
}

/** Video clips from an OpenTimelineIO JSON: [{ name, recIn, recOut }] in frames at `fps` (first video track). */
export function parseOtio(json, fps) {
  const track = (json.tracks?.children ?? []).find((t) => t.kind === "Video") ?? json.tracks?.children?.[0];
  const out = [];
  let at = 0;
  for (const c of track?.children ?? []) {
    const d = c.source_range?.duration ?? c.media_reference?.available_range?.duration;
    if (!d) continue;
    const len = Math.round((d.value / d.rate) * fps);
    if (c.OTIO_SCHEMA?.startsWith("Clip")) out.push({ name: String(c.name ?? "").replace(/\.[A-Za-z0-9]+$/, ""), recIn: at, recOut: at + len });
    at += len;
  }
  return out;
}

/** Re-point the server's OTIO at the exported clips: names, files, handles. Dialogue tracks are kept as they are. */
export function patchOtio(otio, plans, fps) {
  const rt = (n) => ({ OTIO_SCHEMA: "RationalTime.1", rate: fps, value: n });
  const range = (a, n) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(a), duration: rt(n) });
  const byId = new Map(plans.map((p) => [p.id, p]));
  for (const tr of otio.tracks?.children ?? []) {
    if (tr.kind !== "Video") continue;
    for (const c of tr.children ?? []) {
      const p = byId.get(String(c.name).split(" ")[0]);
      if (!p) continue;
      c.name = p.name;
      c.source_range = range(p.srcIn, p.srcOut - p.srcIn);
      c.media_references = { DEFAULT_MEDIA: { OTIO_SCHEMA: "ExternalReference.1", target_url: `${p.name}.mp4`, available_range: range(0, p.clipLen), metadata: {} } };
      c.active_media_reference_key = "DEFAULT_MEDIA";
    }
  }
  return otio;
}

/**
 * Compare the crew's cut with an editor's: events [{name, recIn, recOut}] matched to shots by clip name.
 * -> [{ id, ours, theirs, diff }] (frames; diff = theirs - ours; null when the editor dropped the shot) and unmatched names.
 */
export function compareCuts(plans, events) {
  const norm = (s) => String(s).toLowerCase().replace(/\.[a-z0-9]+$/, "");
  const byName = new Map(events.map((e) => [norm(e.name), e]));
  const rows = plans.map((p) => {
    const e = byName.get(norm(p.name)) ?? byName.get(norm(p.id));
    const ours = p.recOut - p.recIn;
    return { id: p.id, ours, theirs: e ? e.recOut - e.recIn : null, diff: e ? e.recOut - e.recIn - ours : null };
  });
  const known = new Set(plans.flatMap((p) => [norm(p.name), norm(p.id)]));
  return { rows, unmatched: events.filter((e) => !known.has(norm(e.name))).map((e) => e.name) };
}
