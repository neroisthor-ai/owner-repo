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
export function clipPlan(shots, fps, handles = 0, duration = Infinity) {
  const end = frames(duration, fps);
  return shots.map((s) => {
    const recIn = frames(s.cutStart, fps), len = Math.max(1, frames(s.cutDur, fps));
    const lead = Math.min(handles, recIn), tail = Math.min(handles, Math.max(0, end - (recIn + len)));
    return { id: s.id, label: s.label ?? "", recIn, recOut: recIn + len, lead, tail, srcIn: lead, srcOut: lead + len, clipLen: lead + len + tail };
  });
}
export const clipName = (plan, take) => `${plan.id}${take ? `_${take}` : ""}`;

/** CMX 3600 EDL: one cut event per shot, the source being that shot's exported clip. */
export function edl(title, fps, plans, { take = "" } = {}) {
  const out = [`TITLE: ${title}`, "FCM: NON-DROP FRAME", ""];
  plans.forEach((p, i) => {
    const t = (n) => tc(n / fps, fps);
    out.push(`${pad(i + 1, 3)}  ${clipName(p, take).replace(/[^A-Za-z0-9]/g, "").slice(0, 8).padEnd(8)} V     C        ${t(p.srcIn)} ${t(p.srcOut)} ${t(p.recIn)} ${t(p.recOut)}`);
    out.push(`* FROM CLIP NAME: ${clipName(p, take)}.mp4`);
    if (p.label) out.push(`* COMMENT: ${p.label}`);
    out.push("");
  });
  return out.join("\n");
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** Final Cut Pro 7 XML (xmeml v5): one clipitem per shot clip. */
export function fcpxml(title, fps, plans, { take = "", width = 1280, height = 720 } = {}) {
  const total = plans.length ? plans[plans.length - 1].recOut : 0;
  const rate = `<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`;
  const items = plans.map((p, i) => `
          <clipitem id="clipitem-${i + 1}">
            <name>${esc(clipName(p, take))}</name>
            <duration>${p.clipLen}</duration>
            ${rate}
            <start>${p.recIn}</start>
            <end>${p.recOut}</end>
            <in>${p.srcIn}</in>
            <out>${p.srcOut}</out>
            <file id="file-${i + 1}">
              <name>${esc(clipName(p, take))}.mp4</name>
              <pathurl>${esc(clipName(p, take))}.mp4</pathurl>
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
