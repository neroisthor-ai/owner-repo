// Shot list (CSV and print) and overhead plans (SVG, one shot per page).
import { baked, server, download, printHtml, esc, toast, csv, tc, projectName, episodeName } from "./util.js";

const E = window.CrewExt;

/** Rows for the shot list. group = sort by camera setup and number the setups. */
export function shotRows(b, { group = false } = {}) {
  const say = (s) => b.audio.filter((a) => a.shot === s.id && a.type === "say").map((a) => `${a.char}: ${a.text}`).join(" / ");
  const setupKey = (s) => {
    const c = s.cam?.[0] ?? [0, 0, 0];
    return [s.scene, s.set, s.lens, Math.round(c[0] * 2) / 2, Math.round(c[2] * 2) / 2, Math.round(c[1] * 2) / 2].join("|");
  };
  let shots = b.shots.map((s, i) => ({ s, i, key: setupKey(s) }));
  const setups = new Map();
  if (group) {
    shots.sort((a, c) => a.s.scene - c.s.scene || String(a.s.set).localeCompare(String(c.s.set)) || a.s.lens - c.s.lens || a.key.localeCompare(c.key) || a.i - c.i);
    for (const x of shots) if (!setups.has(x.key)) setups.set(x.key, setups.size + 1);
  }
  const head = ["Scene", ...(group ? ["Setup"] : []), "Shot", "Type", "Subjects", "Lens (mm)", "Move", "Light", "Cut in", "Cut out", "Duration (s)", "Dialogue"];
  const rows = shots.map(({ s, key }) => [s.scene, ...(group ? [setups.get(key)] : []), s.id, s.type, (s.subjects ?? []).join(" "), s.lens, s.move, s.light, tc(s.cutStart, b.fps), tc(s.cutStart + s.cutDur, b.fps), s.cutDur.toFixed(2), say(s)]);
  return { head, rows };
}

E.on("Shot list export", ({ group }) => {
  const { head, rows } = shotRows(baked(), { group });
  download(`${projectName()}_${episodeName()}_shotlist.csv`, "﻿" + csv([head, ...rows]), "text/csv");
  toast(`Shot list: ${rows.length} shots${group ? ", grouped by camera setup" : ""}.`);
});

E.on("Shot list printing", ({ group }) => {
  const { head, rows } = shotRows(baked(), { group });
  printHtml(`<!doctype html><meta charset="utf-8"><title>${esc(server().title)} shot list</title><style>
    body{font:11px system-ui,sans-serif;margin:14px;color:#111}h1{font-size:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top}th{background:#eee}tr{break-inside:avoid}
  </style><h1>${esc(server().title)} · ${esc(server().episode)} · shot list</h1><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
});

// ---- overhead plans -------------------------------------------------------------------

const PX = 90; // pixels per metre
const num = (n) => Number(n).toFixed(1);

/** SVG plan of one shot: set, furniture and props, marks, actor paths, camera and view cone, 180 degree line. */
export function planSvg(b, shot, propTitles = {}) {
  const set = b.sets[shot.set];
  if (!set) return `<p>No set data for ${esc(shot.id)}.</p>`;
  const open = set.open;
  const pad = open ? 6 : 1;
  const w = set.w + pad * 2, d = set.d + pad * 2;
  const X = (x) => (x + w / 2) * PX, Z = (z) => (z + d / 2) * PX;
  const out = [];
  if (!open) out.push(`<rect x="${X(-set.w / 2)}" y="${Z(-set.d / 2)}" width="${set.w * PX}" height="${set.d * PX}" fill="#f6f6f6" stroke="#222" stroke-width="3"/>`);
  else out.push(`<rect x="${X(-set.w / 2)}" y="${Z(-set.d / 2)}" width="${set.w * PX}" height="${set.d * PX}" fill="none" stroke="#999" stroke-dasharray="6 4"/>`);
  for (const bx of set.boxes ?? []) {
    if (bx.decor && Math.max(bx.w, bx.d) > 20) continue;
    const cx = bx.cx ?? bx.x ?? 0, cz = bx.cz ?? bx.z ?? 0;
    const deg = ((bx.ry ?? bx.yaw ?? 0) * 180) / Math.PI;
    const title = propTitles[bx.prop]?.title ?? bx.kind ?? bx.id;
    out.push(`<g transform="translate(${X(cx)} ${Z(cz)}) rotate(${deg.toFixed(1)})"><rect x="${(-bx.w * PX) / 2}" y="${(-bx.d * PX) / 2}" width="${bx.w * PX}" height="${bx.d * PX}" fill="${bx.decor ? "none" : "#ddd"}" stroke="#666" stroke-dasharray="${bx.decor ? "3 3" : "0"}"/>${bx.w * PX > 36 ? `<text x="0" y="3" text-anchor="middle" font-size="9" fill="#444" transform="rotate(${(-deg).toFixed(1)})">${esc(title)}</text>` : ""}</g>`);
  }
  for (const a of set.anchors ?? []) out.push(`<circle cx="${X(a.x)}" cy="${Z(a.z)}" r="3" fill="#2a6"/><text x="${X(a.x) + 5}" y="${Z(a.z) - 4}" font-size="9" fill="#2a6">${esc(a.id)}</text>`);
  // actors: path over the shot, start and end marks
  const colors = ["#d33", "#36c", "#c80", "#7a3", "#a3a"];
  Object.entries(shot.chars ?? {}).forEach(([id, fr], i) => {
    const pts = fr.filter((f) => f[0]).map((f) => [f[1], f[2], f[3]]);
    if (!pts.length) return;
    const col = colors[i % colors.length], name = b.cast?.[id]?.name ?? id;
    out.push(`<polyline points="${pts.map((p) => `${num(X(p[0]))},${num(Z(p[1]))}`).join(" ")}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="5 3"/>`);
    const [s, e] = [pts[0], pts[pts.length - 1]];
    out.push(`<circle cx="${X(s[0])}" cy="${Z(s[1])}" r="7" fill="${col}" fill-opacity=".25" stroke="${col}"/><text x="${X(s[0]) + 9}" y="${Z(s[1]) + 4}" font-size="11" fill="${col}">${esc(name)}</text>`);
    out.push(`<g transform="translate(${X(e[0])} ${Z(e[1])}) rotate(${((-e[2] * 180) / Math.PI + 180).toFixed(1)})"><circle r="8" fill="${col}"/><path d="M0 -8 L4 -14 L-4 -14 Z" fill="${col}"/></g>`);
  });
  // camera and view cone
  const cam = shot.cam?.[Math.floor((shot.cam.length || 1) / 2)] ?? shot.cam?.[0];
  if (cam) {
    const [px, , pz, tx, , tz, fov] = cam;
    const ang = Math.atan2(tz - pz, tx - px), half = Math.atan(Math.tan((fov * Math.PI) / 360) * (16 / 9));
    const len = 3.2;
    const pt = (a) => `${num(X(px + Math.cos(a) * len))},${num(Z(pz + Math.sin(a) * len))}`;
    out.push(`<polygon points="${num(X(px))},${num(Z(pz))} ${pt(ang - half)} ${pt(ang + half)}" fill="#f59a40" fill-opacity=".18" stroke="#c70"/>`);
    out.push(`<g transform="translate(${X(px)} ${Z(pz)}) rotate(${((ang * 180) / Math.PI).toFixed(1)})"><rect x="-8" y="-6" width="16" height="12" fill="#c70"/><path d="M8 -4 L16 -8 L16 8 L8 4 Z" fill="#c70"/></g>`);
  }
  // 180 degree line between the first two actors (at mid-shot)
  const ids = Object.keys(shot.chars ?? {}).filter((id) => shot.chars[id].some((f) => f[0]));
  if (ids.length >= 2) {
    const at = (id) => { const fr = shot.chars[id], f = fr[Math.floor(fr.length / 2)]; return [f[1], f[2]]; };
    const [a, c] = [at(ids[0]), at(ids[1])], dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz) || 1, k = 4 / L;
    out.push(`<line x1="${X(a[0] - dx * k)}" y1="${Z(a[1] - dz * k)}" x2="${X(c[0] + dx * k)}" y2="${Z(c[1] + dz * k)}" stroke="#d33" stroke-dasharray="10 4" stroke-width="1.5"/><text x="${X(c[0] + dx * k) - 4}" y="${Z(c[1] + dz * k) - 6}" font-size="10" fill="#d33" text-anchor="end">180° line</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w * PX} ${d * PX}" width="100%">${out.join("")}</svg>`;
}

E.on("Overhead plan printing", () => {
  const b = baked();
  const pages = b.shots.map((s) => `<section><h2>${esc(s.id)} · ${esc(s.type)}${s.subjects?.length ? " " + esc(s.subjects.join(" ")) : ""} · ${s.lens}mm ${esc(s.move)}</h2><p>${esc(s.set)} · ${esc(s.light)} · ${s.cutDur.toFixed(1)}s</p>${planSvg(b, s, E.props ?? {})}<p class="k">Dashed = actor path (circle start, arrow end). Orange = camera and view. Green = stand marks.</p></section>`).join("");
  printHtml(`<!doctype html><meta charset="utf-8"><title>${esc(server().title)} plans</title><style>
    body{font:12px system-ui,sans-serif;margin:14px;color:#111}section{break-after:page;max-width:900px}h2{font-size:15px;margin:0}p{margin:2px 0 8px;color:#444}.k{font-size:10px}
  </style>${pages}`);
});

E.wired("Shot list and plans");
