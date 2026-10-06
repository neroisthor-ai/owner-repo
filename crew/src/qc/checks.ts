// Quality control. Code checks first: they are free and exact. Models only
// judge what code can't (see crew/screening.ts). Every report says what was
// checked and what was not.

import type { Compiled, CompiledShot } from "../scene/compile.ts";
import type { Issue } from "../scene/parse.ts";
import { PHYSICS } from "../scene/registry.ts";
import { cylinderInto, insideRoom, pointInBox, rayBox, raySphere } from "../scene/geometry.ts";

export type Severity = "error" | "warn" | "info";

export interface QcIssue {
  check: string;
  severity: Severity;
  shot: string | null;
  addr: string | null;
  local?: number; // seconds into the shot
  message: string;
}

export interface QcReport {
  issues: QcIssue[];
  checked: string[];
  notChecked: string[];
  counts: Record<Severity, number>;
}

export const CHECKS = [
  "grammar and registry validity",
  "subject in frame (sampled every 4 frames)",
  "bodies inside furniture and set dressing (from the prop library's sizes)",
  "sitting with nothing to sit on",
  "camera inside walls or furniture",
  "subject blocked by furniture or people",
  "character intersection",
  "foot sliding / walk speed",
  "head snaps (pose popping)",
  "eyelines on OTS shots",
  "180-degree rule across consecutive shots",
  "continuity (entries, exits, props held, jumps across cuts)",
  "reach distance for prop actions",
  "dialogue timing vs speaking pace, overlaps, lines clipped by the cut",
  "average shot length vs the Style Bible",
];

export const NOT_CHECKED = [
  "whether the beat lands or the scene is boring (run a test screening)",
  "lip-sync accuracy (animatic uses temp mouth flaps)",
  "final lighting and look (grey-box previs)",
  "hands and limbs vs furniture (bodies are checked as cylinders)",
  "performance quality (no capture yet)",
  "audio mix levels",
];

export function runQc(c: Compiled, grammar: Issue[]): QcReport {
  const issues: QcIssue[] = [];
  for (const g of grammar) issues.push({ check: "grammar", severity: "error", shot: g.addr.split(".")[0] || null, addr: g.addr, message: `line ${g.line}: ${g.message}` });
  for (const s of c.issues) issues.push({ check: s.check, severity: s.severity, shot: s.shot, addr: s.addr, local: s.local, message: s.message });

  const fps = c.fps;
  const step = 4 / fps;
  for (const shot of c.shots) {
    const present = c.presentIn(shot);
    const h = shot.header;
    const inEnd = shot.dur - shot.trimTail;
    const times: number[] = [];
    for (let t = shot.trimHead; t <= inEnd + 1e-6; t += step) times.push(t);

    // --- subjects in frame
    let subjects: string[] = [];
    if (h.type === "OTS" || h.type === "POV") subjects = h.subjects.slice(1);
    else if (h.type === "INSERT") subjects = [];
    else subjects = h.subjects.length ? h.subjects : present;
    for (const id of subjects) {
      if (!present.includes(id)) {
        issues.push({ check: "framing", severity: "error", shot: shot.id, addr: shot.id, message: `${id} is the subject of ${shot.id} but isn't on set during it` });
        continue;
      }
      let outFor = 0, first = -1, worst = 0;
      for (const t of times) {
        const s = c.charAt(shot, t, id);
        if (!s.present) { outFor = 0; continue; }
        const tight = ["ECU", "CU", "MCU"].includes(h.type);
        const y = tight ? c.eye(id, s) : c.eye(id, s) + 0.12;
        const ndc = project(c.camAt(shot, t), [s.x, y, s.z]);
        const off = ndc === null ? 9 : Math.max(Math.abs(ndc[0]), Math.abs(ndc[1]));
        if (off > 1.0) { if (outFor === 0) first = t; outFor += step; worst = Math.max(worst, off); }
        else outFor = 0;
        if (outFor >= 0.33) break;
      }
      if (outFor >= 0.33) {
        issues.push({
          check: "framing", severity: "error", shot: shot.id, addr: shot.id, local: round(first),
          message: `${id} leaves frame at ${first.toFixed(1)}s in ${shot.id} (${shot.move} camera${shot.move === "static" ? "; try pan or track" : ""})`,
        });
      }
    }

    // --- intersection
    for (let i = 0; i < present.length; i++) for (let j = i + 1; j < present.length; j++) {
      const a = present[i], b = present[j];
      for (const t of times) {
        const A = c.charAt(shot, t, a), B = c.charAt(shot, t, b);
        if (!A.present || !B.present) continue;
        const d = Math.hypot(A.x - B.x, A.z - B.z);
        if (d < PHYSICS.personRadius * 2) {
          issues.push({ check: "intersection", severity: "error", shot: shot.id, addr: shot.id, local: round(t), message: `${a} and ${b} intersect at ${t.toFixed(1)}s (${(d * 100).toFixed(0)}cm apart)` });
          break;
        }
      }
    }

    // --- bodies inside furniture, camera inside geometry, subjects blocked (after The Bob's QA audit)
    const g = c.geometry(shot);
    for (const id of present) {
      for (const t of times) {
        const s = c.charAt(shot, t, id);
        if (!s.present) continue;
        const sitting = s.pose === 1 && s.poseAmt > 0.3;
        const r = PHYSICS.personRadius * 0.85;
        const box = g.obstacles.find((b) => b.solid && !(b.sittable && (sitting || s.walk < 0)) && cylinderInto(b, s.x, s.z, r, c.height(id)) > 0.04);
        if (box) {
          issues.push({ check: "furniture", severity: "error", shot: shot.id, addr: shot.id, local: round(t), message: `${id} is inside the ${box.id} at ${t.toFixed(1)}s (${(cylinderInto(box, s.x, s.z, r, c.height(id)) * 100).toFixed(0)}cm in)` });
          break;
        }
      }
    }
    for (const id of present) {
      for (const t of times) {
        const s = c.charAt(shot, t, id);
        if (!s.present || s.pose !== 1 || s.poseAmt < 0.9) continue;
        const near = g.obstacles.some((b) => b.sittable && cylinderInto(b, s.x, s.z, 0.45, 1) > 0);
        if (!near) {
          issues.push({ check: "seat", severity: "warn", shot: shot.id, addr: shot.id, local: round(t), message: `${id} sits at ${t.toFixed(1)}s with no chair, sofa or bed under them (give the anchor \`is chair\` or dress a seat)` });
          break;
        }
      }
    }
    {
      let camFlag = false;
      const occFlag = new Set<string>();
      for (const t of times) {
        const cam = c.camAt(shot, t);
        if (!camFlag) {
          const inBox = g.obstacles.find((b) => pointInBox(b, cam.pos));
          if (inBox || !insideRoom(g, cam.pos, 0)) {
            issues.push({ check: "camera", severity: "error", shot: shot.id, addr: shot.id, local: round(t), message: `camera is inside ${inBox ? "the " + inBox.id : "a wall"} at ${t.toFixed(1)}s` });
            camFlag = true;
          }
        }
        for (const id of subjects) {
          if (occFlag.has(id)) continue;
          const s = c.charAt(shot, t, id);
          if (!s.present) continue;
          const e = [s.x, c.eye(id, s), s.z];
          const v = [e[0] - cam.pos[0], e[1] - cam.pos[1], e[2] - cam.pos[2]];
          const D = Math.hypot(v[0], v[1], v[2]);
          const dir = [v[0] / D, v[1] / D, v[2] / D];
          let blocker: string | null = null;
          for (const b of g.obstacles) if (rayBox(b, cam.pos, dir) < D - 0.25) { blocker = "the " + b.id; break; }
          if (!blocker) for (const o of present) {
            if (o === id || h.subjects.includes(o)) continue;
            const os = c.charAt(shot, t, o);
            if (!os.present) continue;
            if (raySphere([os.x, c.eye(o, os), os.z], 0.11, cam.pos, dir) < D - 0.25 || raySphere([os.x, c.height(o) * 0.6, os.z], 0.2, cam.pos, dir) < D - 0.25) { blocker = o; break; }
          }
          if (blocker) {
            issues.push({ check: "occlusion", severity: "warn", shot: shot.id, addr: shot.id, local: round(t), message: `${id}'s face is blocked by ${blocker} at ${t.toFixed(1)}s` });
            occFlag.add(id);
          }
        }
      }
    }

    // --- head snaps
    for (const id of present) {
      let prev: number | null = null;
      for (let t = shot.trimHead; t <= inEnd; t += 1 / fps) {
        const s = c.charAt(shot, t, id);
        if (!s.present) { prev = null; continue; }
        if (prev !== null) {
          let dv = Math.abs(s.head - prev);
          if (dv > Math.PI) dv = 2 * Math.PI - dv;
          if (dv * fps > 14) { issues.push({ check: "popping", severity: "warn", shot: shot.id, addr: shot.id, local: round(t), message: `${id}'s head snaps ${(dv * 57.3).toFixed(0)}° in one frame at ${t.toFixed(1)}s` }); break; }
        }
        prev = s.head;
      }
    }

    // --- eyelines (an OTS is built on b looking back at a; a POV isn't)
    if (h.type === "OTS" && h.subjects.length === 2) {
      const [a, b] = h.subjects;
      const mid = (shot.trimHead + inEnd) / 2;
      const A = c.charAt(shot, mid, a), B = c.charAt(shot, mid, b);
      if (A.present && B.present) {
        const want = Math.atan2(A.x - B.x, A.z - B.z);
        let off = Math.abs(want - B.head);
        if (off > Math.PI) off = 2 * Math.PI - off;
        if (off > 1.1) issues.push({ check: "eyeline", severity: "warn", shot: shot.id, addr: shot.id, local: round(mid), message: `${b} is looking ${(off * 57.3).toFixed(0)}° away from ${a} in an ${h.type} built on their eyeline (add "${b} look ${a}")` });
      }
    }
  }

  // --- 180 rule
  for (let i = 1; i < c.shots.length; i++) {
    const p = c.shots[i - 1], s = c.shots[i];
    if (p.sceneIndex === s.sceneIndex && p.lineSide && s.lineSide && p.lineSide !== s.lineSide) {
      issues.push({ check: "180", severity: "warn", shot: s.id, addr: s.id, message: `${s.id} crosses the line established before it (cut ${p.id} -> ${s.id} flips screen direction)` });
    }
  }

  // --- dialogue overlaps
  const says = c.audio.filter((e) => e.type === "say");
  for (let i = 1; i < says.length; i++) {
    const a = says[i - 1], b = says[i];
    if (b.t < a.t + a.dur - 0.15 && a.char !== b.char) issues.push({ check: "timing", severity: "warn", shot: b.shot, addr: b.addr, message: `${b.char} talks over ${a.char} (${(a.t + a.dur - b.t).toFixed(1)}s overlap)` });
  }

  // --- ASL
  if (c.shots.length) {
    const asl = c.duration / c.shots.length;
    const target = c.show.style.asl;
    if (asl > target * 1.5 || asl < target * 0.5) issues.push({ check: "asl", severity: "info", shot: null, addr: null, message: `average shot length ${asl.toFixed(1)}s vs Style Bible ${target}s` });
    for (const s of c.shots) if (s.cutDur > target * 3) issues.push({ check: "asl", severity: "info", shot: s.id, addr: s.id, message: `${s.id} runs ${s.cutDur.toFixed(1)}s, ${(s.cutDur / target).toFixed(1)}x the show's average` });
  }

  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  return { issues, checked: CHECKS, notChecked: NOT_CHECKED, counts };
}

function round(v: number) { return Math.round(v * 100) / 100; }

/** Project a world point into normalized device coordinates of a 16:9 frame. */
export function project(cam: { pos: number[]; target: number[]; fov: number }, p: number[]): [number, number] | null {
  const f = norm(sub(cam.target, cam.pos));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const d = sub(p, cam.pos);
  const z = dot(d, f);
  if (z <= 0.05) return null;
  const tv = Math.tan((cam.fov * Math.PI) / 360);
  const th = tv * (16 / 9);
  return [dot(d, r) / (z * th), dot(d, u) / (z * tv)];
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Key for comparing issue sets before/after a patch. */
export const issueKey = (i: QcIssue) => `${i.severity}|${i.check}|${i.shot}|${i.message.replace(/[\d.]+s\b|\d+(\.\d+)?/g, "#")}`;

export function summarize(r: QcReport): string {
  return `${r.counts.error} errors, ${r.counts.warn} warnings, ${r.counts.info} notes`;
}

export type { CompiledShot };
