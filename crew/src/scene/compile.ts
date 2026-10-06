// SCENE -> time. The compiler simulates every scene with real-world defaults
// (walking speed, speaking pace, lens/sensor optics), then bakes frames that the
// browser animatic (and any final renderer) plays back verbatim. Previs never
// re-derives anything, so it can't drift from what the checks measured.

import { createHash } from "node:crypto";
import type { ActionLine, Doc, Show, ShotHeader, SetDef, CastMember, BodyNode } from "./ast.ts";
import { structure } from "./parse.ts";
import { lipOpenAt } from "../voice/dsp.ts";
import type { VoiceLookup } from "../voice/bank.ts";
import { aimHeight, insideRoom, pointInBox, rayBox, rayRoom, setGeometry, topHeight, type SetGeometry, type Box } from "./geometry.ts";
import {
  ACTION_VERBS, DEFAULT_WPM, EXPRESSIONS, LINE_TAIL, MOVE_SPEEDS, PALETTES, PHRASE_PAUSE, PHYSICS,
  SFX, SHOT_SIZES, SPEECH_VERBS,
} from "./registry.ts";

// ---------------------------------------------------------------- public types

export const GESTURES = ["nod", "shake", "shrug", "sigh", "wave", "point", "blink", "reach"];
export const POSES = ["stand", "sit", "kneel", "lean"];

export interface Beat {
  addr: string;
  t0: number; // local (shot) seconds
  t1: number;
  kind: string;
  label: string;
}

export interface SimIssue {
  shot: string;
  addr: string;
  severity: "error" | "warn";
  check: string;
  message: string;
  local?: number;
}

export interface AudioEvent {
  t: number; // cut time (seconds)
  shot: string;
  addr: string;
  type: "say" | "sfx" | "music" | "ambience" | "silence";
  dur: number;
  name?: string;
  char?: string;
  text?: string;
  verb?: string;
  voice?: string;
  clipped?: boolean;
  /** URL of the rendered voice clip, when there is one */
  src?: string;
  /** base64 mouth track for the clip (4 bytes/frame at 30 fps: open, wide, round, emphasis) */
  lips?: string;
}

export interface Cam {
  pos: [number, number, number];
  target: [number, number, number];
  fov: number; // vertical, degrees, for a 16:9 frame
}

export interface CompiledShot {
  id: string;
  index: number;
  scene: number;
  sceneIndex: number;
  set: string;
  act: number | null;
  header: ShotHeader;
  label: string;
  light: string;
  palette: string;
  lens: number;
  move: string;
  speed: string;
  worldStart: number;
  dur: number; // action length
  trimHead: number;
  trimTail: number;
  hold: number;
  cutStart: number;
  cutDur: number;
  beats: Beat[];
  lineSide: number; // which side of the scene's 180 line the camera is on (+1/-1, 0 = no line)
  hash: string;
}

export interface CharState {
  present: boolean;
  x: number;
  z: number;
  yaw: number;
  head: number;
  pose: number;
  poseAmt: number;
  expr: string;
  look: string | null;
  talk: number;
  gesture: number; // index + progress, -1 none
  walk: number; // gait phase 0..1, -1 when still
  speed: number; // current m/s
}

export interface PropState {
  x: number;
  y: number;
  z: number;
  holder: string | null;
  open: boolean;
}

export interface Compiled {
  show: Show;
  fps: number;
  duration: number;
  shots: CompiledShot[];
  audio: AudioEvent[];
  issues: SimIssue[];
  charAt(shot: CompiledShot, local: number, id: string): CharState;
  propAt(shot: CompiledShot, local: number, id: string): PropState;
  camAt(shot: CompiledShot, local: number): Cam;
  presentIn(shot: CompiledShot): string[];
  eye(id: string, s: CharState): number;
  geometry(shot: CompiledShot): SetGeometry;
  height(id: string): number;
}

// ---------------------------------------------------------------- small math

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (u: number) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const yawTo = (dx: number, dz: number) => Math.atan2(dx, dz);
const dist2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(bx - ax, bz - az);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const speechSeconds = (text: string, wpm: number, verb: string): number => {
  const words = text.split(/\s+/).filter(Boolean).length;
  const pace = wpm * (SPEECH_VERBS[verb]?.pace ?? 1);
  const breaks = (text.match(/[.?!;:—…-]\s+\S/g) ?? []).length;
  const commas = (text.match(/,\s+\S/g) ?? []).length;
  return Math.max(0.6, (words / pace) * 60 + breaks * PHRASE_PAUSE + commas * 0.15);
};

// ---------------------------------------------------------------- tracks

interface MoveKey { t: number; x: number; z: number; move?: { t1: number; ramp: number } }
interface YawKey { t: number; v: number; ease?: boolean }
interface PoseKey { t: number; pose: number; amt: number }
interface Disc<T> { t: number; v: T }

class CharTrack {
  pos: MoveKey[] = [];
  yaw: YawKey[] = [];
  pose: PoseKey[] = [{ t: -1e9, pose: 0, amt: 0 }];
  present: Disc<boolean>[] = [{ t: -1e9, v: false }];
  expr: Disc<string>[] = [{ t: -1e9, v: "neutral" }];
  look: Disc<string | null>[] = [{ t: -1e9, v: null }];
  talk: { t0: number; t1: number; lips?: Uint8Array }[] = [];
  gest: { t0: number; t1: number; g: number }[] = [];
  walks: { t0: number; t1: number; speed: number; peak: number; run: boolean }[] = [];

  static disc<T>(keys: Disc<T>[], t: number): T {
    let v = keys[0].v;
    for (const k of keys) { if (k.t <= t) v = k.v; else break; }
    return v;
  }
  static put<T extends { t: number }>(keys: T[], k: T) {
    let i = keys.length;
    while (i > 0 && keys[i - 1].t > k.t) i--;
    keys.splice(i, 0, k);
  }

  posAt(t: number): [number, number] {
    const k = this.pos;
    if (!k.length) return [0, 0];
    if (t <= k[0].t) return [k[0].x, k[0].z];
    for (let i = 0; i < k.length - 1; i++) {
      const a = k[i], b = k[i + 1];
      if (t >= a.t && t < b.t) {
        if (!a.move) return [a.x, a.z];
        const D = b.t - a.t, r = a.move.ramp, vmax = 1 / (D - r);
        const tt = t - a.t;
        const f = tt < r ? 0.5 * vmax * tt * tt / r : tt > D - r ? 1 - 0.5 * vmax * (D - tt) ** 2 / r : 0.5 * vmax * r + vmax * (tt - r);
        return [a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f];
      }
    }
    const l = k[k.length - 1];
    return [l.x, l.z];
  }
  place(t: number, x: number, z: number) {
    this.pos = this.pos.filter((k) => k.t < t);
    const prev = this.pos[this.pos.length - 1];
    if (prev) { const [px, pz] = this.posAt(t); this.pos.push({ t: t - 1e-4, x: px, z: pz }); }
    this.pos.push({ t, x, z });
  }
  move(t0: number, t1: number, x: number, z: number) {
    const [sx, sz] = this.posAt(t0);
    this.pos = this.pos.filter((k) => k.t < t0);
    const D = t1 - t0;
    this.pos.push({ t: t0, x: sx, z: sz, move: { t1, ramp: Math.min(0.35, D / 3) } }, { t: t1, x, z });
  }
  yawAt(t: number): number {
    const k = this.yaw;
    if (!k.length) return 0;
    if (t <= k[0].t) return wrap(k[0].v);
    for (let i = 0; i < k.length - 1; i++) {
      const a = k[i], b = k[i + 1];
      if (t >= a.t && t < b.t) return wrap(b.ease ? a.v + wrap(b.v - a.v) * smooth((t - a.t) / (b.t - a.t)) : a.v);
    }
    return wrap(k[k.length - 1].v);
  }
  turn(t0: number, t1: number, v: number) {
    const cur = this.yawAt(t0);
    this.yaw = this.yaw.filter((k) => k.t < t0);
    // the start key eases too, so a turn interrupted on the same instant keeps its arc
    this.yaw.push({ t: t0, v: cur, ease: true }, { t: Math.max(t1, t0 + 1e-3), v: cur + wrap(v - cur), ease: true });
  }
  poseAt(t: number): { pose: number; amt: number } {
    const k = this.pose;
    let a = k[0];
    for (let i = 0; i < k.length; i++) {
      if (k[i].t > t) {
        const b = k[i];
        const u = (t - a.t) / (b.t - a.t);
        if (b.pose === a.pose || a.amt === 0) return { pose: b.amt > 0 ? b.pose : a.pose, amt: a.amt + (b.amt - a.amt) * smooth(u) };
        return { pose: a.pose, amt: a.amt * (1 - smooth(u)) };
      }
      a = k[i];
    }
    return { pose: a.pose, amt: a.amt };
  }
  setPose(t0: number, t1: number, pose: number) {
    const cur = this.poseAt(t0);
    this.pose = this.pose.filter((k) => k.t < t0);
    this.pose.push({ t: t0, pose: cur.pose, amt: cur.amt });
    if (pose === 0) this.pose.push({ t: t1, pose: cur.pose, amt: 0 });
    else if (cur.amt > 0 && cur.pose !== pose) {
      const mid = (t0 + t1) / 2;
      this.pose.push({ t: mid, pose: cur.pose, amt: 0 }, { t: t1, pose, amt: 1 });
    } else this.pose.push({ t: t1, pose, amt: 1 });
  }
}

interface PropTrack { keys: Disc<{ holder: string | null; x: number; y: number; z: number; open: boolean }>[] }

// ---------------------------------------------------------------- compile

export interface CompileOptions {
  /** real voice clips: duration + mouth track per line (see src/voice/bank.ts) */
  voices?: VoiceLookup;
}

export function compile(show: Show, doc: Doc, opts: CompileOptions = {}): Compiled {
  const st = structure(doc);
  const style = show.style;
  const fps = style.fps;
  const issues: SimIssue[] = [];
  const audioWorld: (AudioEvent & { world: number; sceneIndex: number })[] = [];
  const shots: CompiledShot[] = [];

  // per scene simulation state
  const sceneChars: Map<string, CharTrack>[] = [];
  const sceneProps: Map<string, PropTrack>[] = [];
  const sceneLine: ([string, string] | null)[] = [];
  const sceneSets: SetDef[] = [];

  const castOf = (id: string): CastMember => show.cast[id] ?? { id, name: id, height: 1.7, color: "#888", voice: "neutral", pace: null, model: null };

  st.scenes.forEach((sc, si) => {
    const set = show.sets[sc.node.set] ?? { id: sc.node.set, w: 8, d: 6, entrance: "", anchors: {}, props: {}, dress: [] };
    sceneSets.push(set);
    const chars = new Map<string, CharTrack>();
    const props = new Map<string, PropTrack>();
    for (const p of Object.values(set.props)) props.set(p.id, { keys: [{ t: -1e9, v: { holder: null, x: p.x, y: p.y, z: p.z, open: false } }] });
    sceneChars.push(chars);
    sceneProps.push(props);
    let line: [string, string] | null = null;
    let world = 0;
    let light = sc.node.time === "night" ? "night" : sc.node.time === "dawn" || sc.node.time === "dusk" ? "warm" : "day";
    const palette = (sc.node.act !== null && style.acts[sc.node.act]?.palette) || style.palette;

    const track = (id: string) => { let t = chars.get(id); if (!t) { t = new CharTrack(); chars.set(id, t); } return t; };
    const anchorPos = (name: string): [number, number] | null => {
      const a = set.anchors[name];
      return a ? [a.x, a.z] : null;
    };
    const center: [number, number] = [0, 0];

    for (const shot of sc.shots) {
      const h = shot.header;
      const pairTypes = ["OTS", "POV", "TWO"];
      if (!line && pairTypes.includes(h.type) && h.subjects.length === 2) line = [...h.subjects].sort() as [string, string];
      const beats: Beat[] = [];
      let gStart = world, gEnd = world;
      let trimHead = 0, trimTail = 0, hold = 0;
      const local = (t: number) => t - world;
      const issue = (addr: string, severity: SimIssue["severity"], check: string, message: string, t?: number) =>
        issues.push({ shot: h.id, addr, severity, check, message, local: t === undefined ? undefined : r3(local(t)) });

      let firstBeat = true;
      for (const b of shot.body) {
        const n = b.node as BodyNode;
        if (n.kind === "comment") continue;
        if (n.kind === "light") { light = n.mood; continue; }
        if (n.kind === "edit") {
          if (n.verb === "trim") { trimHead = n.a; trimTail = n.b ?? 0; } else hold = n.a;
          continue;
        }
        const isWith = n.with;
        if (!isWith) gStart = gEnd;
        const T = gStart;
        let d = 0;
        let weight = true;
        let label = "";

        if (n.kind === "sound") {
          label = `${n.verb}${n.name ? " " + n.name : ""}`;
          if (n.verb === "sfx") {
            d = n.dur ?? SFX[n.name ?? ""] ?? 0.5;
            weight = !isWith;
            audioWorld.push({ world: T, sceneIndex: si, t: 0, shot: h.id, addr: b.addr, type: "sfx", name: n.name ?? "", dur: d });
          } else if (n.verb === "silence") {
            d = n.dur ?? 1;
            weight = !isWith;
            audioWorld.push({ world: T, sceneIndex: si, t: 0, shot: h.id, addr: b.addr, type: "silence", dur: d });
          } else {
            weight = false;
            audioWorld.push({ world: T, sceneIndex: si, t: 0, shot: h.id, addr: b.addr, type: n.verb as "music" | "ambience", name: n.name ?? "stop", dur: 0 });
          }
        } else {
          const c = track(n.actor);
          const present = CharTrack.disc(c.present, T);
          const at = n.kind === "action" ? n.at : null;
          if (at) {
            const p = anchorPos(at);
            if (p) {
              const [cx, cz] = c.posAt(T);
              const jump = present && dist2(cx, cz, p[0], p[1]) > 0.3;
              if (jump) {
                if (firstBeat) issue(b.addr, "warn", "continuity", `${n.actor} jumps from (${cx.toFixed(1)}, ${cz.toFixed(1)}) to ${at} across the cut into ${h.id}`, T);
                else issue(b.addr, "error", "continuity", `${n.actor} teleports to ${at} mid-shot`, T);
              }
              if (!present || jump) {
                c.place(T, p[0], p[1]);
                const a = set.anchors[at];
                const face = a.face !== null ? (a.face * Math.PI) / 180 : yawTo(center[0] - p[0], center[1] - p[1]);
                c.yaw = c.yaw.filter((k) => k.t < T);
                c.yaw.push({ t: T, v: face });
              }
              if (!present) CharTrack.put(c.present, { t: T, v: true });
            }
          } else if (!present && !(n.kind === "action" && n.verb === "enter")) {
            issue(b.addr, "error", "continuity", `${n.actor} acts before entering the scene (add ${n.actor}@<anchor> or an enter)`, T);
            const e = anchorPos(set.entrance) ?? [0, 0];
            c.place(T, e[0], e[1]);
            CharTrack.put(c.present, { t: T, v: true });
          }

          if (n.kind === "dialogue") {
            const wpm = castOf(n.actor).pace ?? style.pace ?? DEFAULT_WPM;
            // a rendered voice clip times the line to the real performance; otherwise speaking pace estimates it
            const clip = opts.voices?.(n.actor, n.verb, n.text) ?? null;
            const speech = clip ? clip.duration : speechSeconds(n.text, wpm, n.verb);
            d = n.dur ?? speech + LINE_TAIL;
            if (n.dur !== null && n.dur < speech * 0.75) issue(b.addr, "warn", "timing", `${n.actor}'s line needs ~${speech.toFixed(1)}s ${clip ? "as recorded" : `at ${wpm} wpm`} but is squeezed into ${n.dur}s`, T);
            c.talk.push({ t0: T, t1: T + Math.min(speech, d), lips: clip?.lips });
            if (n.to) CharTrack.put(c.look, { t: T, v: n.to });
            audioWorld.push({ world: T, sceneIndex: si, t: 0, shot: h.id, addr: b.addr, type: "say", char: n.actor, text: n.text, verb: n.verb, voice: castOf(n.actor).voice, dur: Math.min(speech, d), ...(clip ? { src: clip.url, lips: Buffer.from(clip.lips).toString("base64") } : {}) });
            label = `${n.actor} ${n.verb}`;
          } else {
            const r = runAction(n, T, c, chars, props, set, castOf, (sev, check, msg) => issue(b.addr, sev, check, msg, T));
            d = r;
            label = `${n.actor} ${n.verb}${n.target ? " " + n.target : ""}`;
          }
        }
        if (weight) gEnd = Math.max(gEnd, T + d);
        beats.push({ addr: b.addr, t0: r3(T - world), t1: r3(T - world + d), kind: n.kind, label });
        firstBeat = false;
      }

      const action = gEnd > world ? gEnd - world + style.pad : 2.0;
      const dur = r3(action);
      if (trimHead + trimTail > dur - 0.2) issue(h.id, "error", "edit", `trim ${trimHead}+${trimTail}s leaves less than 0.2s of a ${dur.toFixed(1)}s shot`);
      const cutDur = r3(Math.max(0.2, dur - trimHead - trimTail) + hold);
      const lens = h.lens ?? style.lens;
      shots.push({
        id: h.id, index: shots.length, scene: sc.node.n, sceneIndex: si, set: set.id, act: sc.node.act, header: h,
        label: `${h.type}${h.subjects.length ? " " + h.subjects.join(">") : ""}`,
        light, palette, lens, move: h.move ?? style.move, speed: h.speed ?? style.speed,
        worldStart: world, dur, trimHead, trimTail, hold, cutStart: 0, cutDur, beats, lineSide: 0, hash: "",
      });
      world += dur;
    }
    sceneLine.push(line);
  });

  // cut timeline
  let cut = 0;
  for (const s of shots) { s.cutStart = r3(cut); cut += s.cutDur; }

  // ---------------------------------------------------------------- evaluation

  const charAt = (shot: CompiledShot, local: number, id: string): CharState => {
    const c = sceneChars[shot.sceneIndex].get(id);
    const t = shot.worldStart + local;
    if (!c) return { present: false, x: 0, z: 0, yaw: 0, head: 0, pose: 0, poseAmt: 0, expr: "neutral", look: null, talk: 0, gesture: -1, walk: -1, speed: 0 };
    const [x, z] = c.posAt(t);
    const yaw = c.yawAt(t);
    const look = CharTrack.disc(c.look, t);
    let head = yaw;
    if (look) {
      const target = lookPoint(shot, t, look);
      if (target) head = wrap(yaw + clamp(wrap(yawTo(target[0] - x, target[1] - z) - yaw), -1.45, 1.45));
    }
    const talking = c.talk.find((k) => t >= k.t0 && t < k.t1);
    const talk = talking?.lips ? lipOpenAt(talking.lips, t - talking.t0) : talking ? Math.abs(Math.sin((t - talking.t0) * Math.PI * 4.7)) * 0.8 + 0.2 * Math.abs(Math.sin((t - talking.t0) * 11.3)) : 0;
    const g = c.gest.find((k) => t >= k.t0 && t < k.t1);
    const w = c.walks.find((k) => t >= k.t0 && t < k.t1);
    const ps = c.poseAt(t);
    let speed = 0;
    if (w) { const [x2, z2] = c.posAt(t + 0.02); speed = dist2(x, z, x2, z2) / 0.02; }
    return {
      present: CharTrack.disc(c.present, t), x, z, yaw, head, pose: ps.pose, poseAmt: ps.amt, expr: CharTrack.disc(c.expr, t), look,
      talk, gesture: g ? g.g + clamp((t - g.t0) / (g.t1 - g.t0), 0, 0.999) : -1,
      walk: w ? (((t - w.t0) * (w.run ? 2.6 : 1.7)) % 1) : -1, speed,
    };
  };

  const propAt = (shot: CompiledShot, local: number, id: string): PropState => {
    const p = sceneProps[shot.sceneIndex].get(id);
    const t = shot.worldStart + local;
    if (!p) return { x: 0, y: 0, z: 0, holder: null, open: false };
    const v = CharTrack.disc(p.keys, t);
    if (v.holder) {
      const c = charAt(shot, local, v.holder);
      const hgt = castOf(v.holder).height;
      return { x: c.x + Math.sin(c.yaw) * 0.32 + Math.cos(c.yaw) * 0.18, y: hgt * 0.55, z: c.z + Math.cos(c.yaw) * 0.32 - Math.sin(c.yaw) * 0.18, holder: v.holder, open: v.open };
    }
    return { ...v };
  };

  function lookPoint(shot: CompiledShot, t: number, name: string): [number, number, number] | null {
    const set = sceneSets[shot.sceneIndex];
    const local = t - shot.worldStart;
    if (show.cast[name]) {
      const c = sceneChars[shot.sceneIndex].get(name);
      if (!c) return null;
      const [x, z] = c.posAt(t);
      return [x, eyeOf(name, charAtNoLook(shot, local, name)), z];
    }
    if (set.anchors[name]) { const a = set.anchors[name]; return [a.x, a.furniture ? aimHeight(a.furniture) ?? 1 : 1, a.z]; }
    if (set.props[name]) { const p = propAt(shot, local, name); return [p.x, p.y, p.z]; }
    return null;
  }

  function charAtNoLook(shot: CompiledShot, local: number, id: string) {
    const c = sceneChars[shot.sceneIndex].get(id)!;
    const t = shot.worldStart + local;
    const ps = c.poseAt(t);
    return { pose: ps.pose, poseAmt: ps.amt } as CharState;
  }

  function eyeOf(id: string, s: Pick<CharState, "pose" | "poseAmt">): number {
    const hgt = castOf(id).height;
    const stand = hgt * PHYSICS.eyeRatio;
    const low = s.pose === 1 ? hgt * PHYSICS.sitEyeRatio : s.pose === 2 ? hgt * PHYSICS.kneelEyeRatio : s.pose === 3 ? hgt * 0.9 : stand;
    return stand + (low - stand) * s.poseAmt;
  }

  const presentIn = (shot: CompiledShot): string[] => {
    const out: string[] = [];
    for (const [id] of sceneChars[shot.sceneIndex]) {
      for (const u of [0, 0.5, 1]) if (charAt(shot, shot.dur * u, id).present) { out.push(id); break; }
    }
    return out;
  };

  // ---------------------------------------------------------------- camera

  const aspect = 16 / 9;
  const sensorW = style.sensor[0];
  const sensorH = sensorW / aspect; // 16:9 extraction from the sensor width
  const fovFor = (f: number) => (2 * Math.atan(sensorH / 2 / f) * 180) / Math.PI;

  // Framing solver (after The Bob's DIRECTOR): place the subject's eyes at a
  // size-dependent screen position (headroom + look room), keep the 180 line,
  // then protect(): keep the lens out of walls, furniture and people, trading
  // distance for focal length so the framing holds.
  type V3 = [number, number, number];
  interface Setup {
    pos: V3; aim: V3; anchor: V3; subject: string | null; offset: V3;
    sx: number; sy: number; body: boolean; f: number; master: boolean;
  }
  const setups = new Map<string, Setup>();
  const geo = sceneSets.map((s) => setGeometry(s));
  /** composition: NDC height of the eyes (or body centre for wide sizes), as in The Bob's SIZES table */
  const COMPOSE: Record<string, { sy: number; body?: boolean }> = {
    ECU: { sy: 0.06 }, CU: { sy: 0.14 }, MCU: { sy: 0.34 }, MS: { sy: 0.45 }, MLS: { sy: 0.5 },
    FS: { sy: 0.08, body: true }, WS: { sy: 0.04, body: true }, EWS: { sy: 0.12, body: true },
  };
  const tanV = (f: number) => Math.tan(((fovFor(f) * Math.PI) / 180) / 2);
  const tanH = (f: number) => tanV(f) * aspect;

  const lineNormal = (shot: CompiledShot, t: number): [number, number] | null => {
    const line = sceneLine[shot.sceneIndex];
    if (!line) return null;
    const ca = sceneChars[shot.sceneIndex].get(line[0]), cb = sceneChars[shot.sceneIndex].get(line[1]);
    if (!ca || !cb) return null;
    const [ax, az] = ca.posAt(t), [bx, bz] = cb.posAt(t);
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const vx = (bx - ax) / len, vz = (bz - az) / len;
    const sign = (shot.header.side ?? style.side) === "left" ? 1 : -1;
    return [vz * sign, -vx * sign];
  };

  /** aim point that puts A at screen position (sx, sy) in NDC */
  function aimAt(P: V3, A: V3, sx: number, sy: number, f: number): V3 {
    const dx = A[0] - P[0], dy = A[1] - P[1], dz = A[2] - P[2];
    const D = Math.hypot(dx, dy, dz) || 1;
    const d = [dx / D, dy / D, dz / D];
    let rt = [-d[2], 0, d[0]]; // d x up
    const rl = Math.hypot(rt[0], rt[2]) || 1;
    rt = [rt[0] / rl, 0, rt[2] / rl];
    const up = [rt[1] * d[2] - rt[2] * d[1], rt[2] * d[0] - rt[0] * d[2], rt[0] * d[1] - rt[1] * d[0]];
    const h = sx * tanH(f) * D, v = sy * tanV(f) * D;
    return [A[0] - rt[0] * h - up[0] * v, A[1] - rt[1] * h - up[1] * v, A[2] - rt[2] * h - up[2] * v];
  }
  /** +1 if X is screen-right of A seen from P */
  function screenSide(P: V3, A: V3, X: V3): number {
    const dx = A[0] - P[0], dz = A[2] - P[2];
    const rx = -dz, rz = dx;
    return (X[0] - P[0]) * rx + (X[2] - P[2]) * rz >= 0 ? 1 : -1;
  }

  /** a camera position that is inside the room and not inside furniture */
  const free = (si: number, P: V3) => insideRoom(geo[si], P, 0.2) && !geo[si].obstacles.some((b) => pointInBox(b, P, -0.15));

  function protect(shot: CompiledShot, local: number, pos: V3, aim: V3, f: number, A: V3, keep: string[], minF: number, master = false): { pos: V3; aim: V3; f: number; k: number } {
    const g = geo[shot.sceneIndex];
    if (master) {
      // a master is placed in free space by construction; only keep it out of people
      const hitPerson = presentIn(shot).some((id) => { const c = charAt(shot, local, id); return c.present && Math.hypot(pos[0] - c.x, pos[2] - c.z) < 0.4; });
      if (!hitPerson) return { pos, aim, f, k: 1 };
    }
    const v = [pos[0] - A[0], pos[1] - A[1], pos[2] - A[2]];
    const D = Math.hypot(v[0], v[1], v[2]);
    if (D < 0.05) return { pos, aim, f, k: 1 };
    const dir = [v[0] / D, v[1] / D, v[2] / D];
    let hit = insideRoom(g, A) ? rayRoom(g, A, dir) + 0.16 : Infinity;
    for (const b of g.obstacles) {
      if (pointInBox(b, A, -0.06)) continue; // the subject is on/at this piece (insert on a table)
      hit = Math.min(hit, rayBox(b, A, dir));
    }
    let nd = hit < D + 0.12 ? Math.max(0.22, hit - 0.16) : D;
    const others = presentIn(shot).filter((id) => !keep.includes(id));
    for (let it = 0; it < 8; it++) {
      const P = [A[0] + dir[0] * nd, A[1] + dir[1] * nd, A[2] + dir[2] * nd];
      const bad = others.some((id) => {
        const c = charAt(shot, local, id);
        if (!c.present) return false;
        const e = eyeOf(id, c);
        return Math.hypot(P[0] - c.x, P[1] - e, P[2] - c.z) < 0.32 || Math.hypot(P[0] - c.x, P[1] - castOf(id).height * 0.55, P[2] - c.z) < 0.4;
      });
      if (!bad) break;
      nd = Math.max(0.22, nd - 0.3);
    }
    if (nd >= D - 1e-3) return { pos, aim, f, k: 1 };
    const k = nd / D;
    const np: V3 = [A[0] + dir[0] * nd, A[1] + dir[1] * nd, A[2] + dir[2] * nd];
    return { pos: np, aim: [aim[0] + np[0] - pos[0], aim[1] + np[1] - pos[1], aim[2] + np[2] - pos[2]], f: Math.max(minF, f * k), k };
  }

  function setup(shot: CompiledShot): Setup {
    const hit = setups.get(shot.id);
    if (hit) return hit;
    const h = shot.header;
    const t0 = shot.worldStart + Math.min(shot.trimHead, shot.dur * 0.5);
    const loc = t0 - shot.worldStart;
    const n = lineNormal(shot, t0);
    const st = (id: string) => charAt(shot, loc, id);
    const eyeP = (id: string): V3 => { const s = st(id); return [s.x, eyeOf(id, s), s.z]; };
    let pos: V3, aim: V3, anchor: V3;
    let subject: string | null = h.subjects[0] ?? null;
    let sx = 0, sy = 0.3, body = false;
    let f = shot.lens;
    let master = false;

    if ((h.type === "OTS" || h.type === "POV") && h.subjects.length === 2) {
      const [a, b] = h.subjects;
      const A = st(a), B = st(b);
      const len = dist2(A.x, A.z, B.x, B.z) || 1;
      const ux = (A.x - B.x) / len, uz = (A.z - B.z) / len;
      anchor = eyeP(b);
      const F = eyeP(a);
      if (h.type === "OTS") {
        let nx = n ? n[0] : -uz, nz = n ? n[1] : ux;
        if (!n) { const s = (h.side ?? style.side) === "left" ? 1 : -1; nx *= s; nz *= s; }
        pos = [A.x + ux * 0.55 + nx * 0.34, F[1] + 0.05, A.z + uz * 0.55 + nz * 0.34];
        sx = -screenSide(pos, anchor, F) * 0.26;
      } else {
        pos = [A.x - ux * 0.12, F[1], A.z - uz * 0.12];
        sx = 0;
      }
      sy = 0.28;
      subject = b;
    } else if (h.type === "TWO" && h.subjects.length === 2) {
      const [a, b] = h.subjects;
      const A = st(a), B = st(b);
      const ea = eyeOf(a, A), eb = eyeOf(b, B);
      anchor = [(A.x + B.x) / 2, (ea + eb) / 2, (A.z + B.z) / 2];
      let nx: number, nz: number;
      if (n) [nx, nz] = n; else { const yaw = (A.yaw + B.yaw) / 2; nx = Math.sin(yaw); nz = Math.cos(yaw); }
      // horizontal span across the frame
      const span = Math.abs((B.x - A.x) * nz - (B.z - A.z) * nx);
      const d = Math.max(1.0 / 2 / tanV(f), (span / 2 + 0.45) / tanH(f));
      pos = [anchor[0] + nx * d, anchor[1] - 0.05, anchor[2] + nz * d];
      sy = 0.3;
      subject = null;
    } else if (h.type === "INSERT" && h.subjects.length === 1) {
      const set = sceneSets[shot.sceneIndex];
      const name = h.subjects[0];
      if (set.props[name]) { const p = propAt(shot, loc, name); anchor = [p.x, p.y, p.z]; }
      else { const a = set.anchors[name]; anchor = [a?.x ?? 0, a?.furniture ? topHeight(a.furniture) ?? 1 : 1, a?.z ?? 0]; }
      const d = 0.42 / 2 / tanV(f);
      const ids = presentIn(shot);
      const near = ids.map((id) => st(id)).filter((c) => c.present).sort((p, q) => dist2(p.x, p.z, anchor[0], anchor[2]) - dist2(q.x, q.z, anchor[0], anchor[2]))[0];
      const yaw = near ? yawTo(near.x - anchor[0], near.z - anchor[2]) + 0.35 : yawTo(-anchor[0], 4 - anchor[2]) + 0.35;
      pos = [anchor[0] + Math.sin(yaw) * d * 0.82, anchor[1] + d * 0.57, anchor[2] + Math.cos(yaw) * d * 0.82];
      sx = 0; sy = 0;
      subject = null;
    } else if (!subject && ["FS", "WS", "EWS", "MLS"].includes(h.type)) {
      const g = geo[shot.sceneIndex];
      const ids = presentIn(shot);
      const pts: [number, number][] = [];
      for (let t = 0; t <= shot.dur; t += 0.25) for (const id of ids) { const c = charAt(shot, t, id); if (c.present) pts.push([c.x, c.z]); }
      if (!pts.length) pts.push([0, 0]);
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      anchor = [cx, 0.85, cz];
      const line = sceneLine[shot.sceneIndex];
      const l0 = line ? sceneChars[shot.sceneIndex].get(line[0])?.posAt(t0) : null;
      const corners: V3[] = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) => [a * (g.w / 2 - 0.35), 1.65, b * (g.d / 2 - 0.35)]);
      const ok = corners.filter((c) => !n || !l0 || (c[0] - l0[0]) * n[0] + (c[2] - l0[1]) * n[1] > 0);
      const roomy = (ok.length ? ok : corners).filter((c) => free(shot.sceneIndex, c));
      const pool = roomy.length ? roomy : ok.length ? ok : corners;
      pos = pool.sort((a, b) => dist2(b[0], b[2], cx, cz) - dist2(a[0], a[2], cx, cz))[0];
      // fit the lens so every position anyone occupies during the shot stays in frame
      const dx = cx - pos[0], dz = cz - pos[2];
      const dl = Math.hypot(dx, dz) || 1;
      let need = 0.2;
      for (const [x, z] of pts) {
        const px = x - pos[0], pz = z - pos[2];
        const depth = Math.max(0.5, (px * dx + pz * dz) / dl);
        const lateral = Math.abs(px * dz - pz * dx) / dl;
        need = Math.max(need, (lateral + 0.45) / depth, ((1.9 - 0.6) / depth) / aspect);
      }
      f = h.lens ?? Math.max(14, Math.min(style.lens, sensorW / 2 / (need * 1.08)));
      shot.lens = Math.round(f);
      sx = 0; sy = 0.05; body = true; master = true;
      subject = null;
    } else {
      const size = SHOT_SIZES[h.type] ?? SHOT_SIZES.WS;
      const comp = COMPOSE[h.type] ?? COMPOSE.WS;
      body = !!comp.body;
      sy = comp.sy;
      let fyaw = 0, headYaw = 0;
      if (subject && show.cast[subject]) {
        const S = st(subject);
        fyaw = S.yaw; headYaw = S.head;
        anchor = body ? [S.x, castOf(subject).height * 0.5 * (S.pose === 1 ? 0.7 : 1), S.z] : [S.x, eyeOf(subject, S), S.z];
      } else {
        const ids = presentIn(shot).filter((id) => st(id).present);
        const ss = ids.map((i) => st(i));
        anchor = ss.length ? [ss.reduce((a, s) => a + s.x, 0) / ss.length, 0.85, ss.reduce((a, s) => a + s.z, 0) / ss.length] : [0, 0.85, 0];
        subject = null;
        body = true;
      }
      let dist = size.frame / 2 / tanV(f);
      const off = 0.5;
      const cands = [fyaw + off, fyaw - off];
      let yaw = cands[(h.side ?? style.side) === "left" ? 0 : 1];
      if (n && subject) {
        // coverage on the established side of the 180 line: down the eyeline if the
        // subject plays toward the other character, otherwise favour their face
        const line = sceneLine[shot.sceneIndex]!;
        const [lx, lz] = sceneChars[shot.sceneIndex].get(line[0])!.posAt(t0);
        const other = line.find((x) => x !== subject) ?? line[1];
        const O = st(other);
        const toOther = O.present ? yawTo(O.x - anchor[0], O.z - anchor[2]) : fyaw;
        const onSide = (yw: number) => (anchor[0] + Math.sin(yw) * dist - lx) * n[0] + (anchor[2] + Math.cos(yw) * dist - lz) * n[1] > 0.05;
        const eyeline = [toOther + 0.45, toOther - 0.45];
        const profiles = [fyaw + 1.25, fyaw - 1.25];
        const order = Math.cos(fyaw - toOther) > 0 ? [...eyeline, ...cands, ...profiles] : [...cands, ...profiles, ...eyeline];
        const at = (yw: number): V3 => [anchor[0] + Math.sin(yw) * dist, anchor[1], anchor[2] + Math.cos(yw) * dist];
        yaw = order.find((yw) => onSide(yw) && free(shot.sceneIndex, at(yw))) ?? order.find(onSide) ?? Math.atan2(n[0], n[1]);
      } else if (!subject) {
        yaw = n ? Math.atan2(n[0], n[1]) : 0;
        const set = sceneSets[shot.sceneIndex];
        dist = Math.max(dist, Math.min(Math.max(set.w, set.d) * 0.6, 6));
      }
      const camY = body ? Math.max(anchor[1], 1.35) : anchor[1];
      pos = [anchor[0] + Math.sin(yaw) * dist, camY, anchor[2] + Math.cos(yaw) * dist];
      // look room: put the subject on the side away from where they're looking
      if (subject) {
        const hf: V3 = [anchor[0] + Math.sin(headYaw), anchor[1], anchor[2] + Math.cos(headYaw)];
        const facing = Math.abs(Math.cos(headYaw - yaw)) > 0.9;
        sx = facing ? 0 : -screenSide(pos, anchor, hf) * (size.frame < 0.4 ? 0.15 : 0.28);
      }
    }
    if (h.angle === "low") pos[1] = Math.max(0.25, anchor[1] - 0.55);
    if (h.angle === "high") pos[1] = anchor[1] + 0.9 + dist2(pos[0], pos[2], anchor[0], anchor[2]) * 0.25;
    aim = aimAt(pos, anchor, sx, sy, f);
    const subjState = subject ? st(subject) : null;
    const offset: V3 = subjState ? [pos[0] - subjState.x, pos[1], pos[2] - subjState.z] : [0, 0, 0];
    const s: Setup = { pos, aim, anchor, subject, offset, sx, sy, body, f, master };
    setups.set(shot.id, s);
    const pr = protect(shot, loc, pos, aim, f, anchor, h.subjects, body ? 16 : 12, master);
    if (pr.k < 0.95 && pr.f < f - 1) {
      issues.push({ shot: h.id, addr: h.id, severity: "warn", check: "lens", message: `${h.id}: the set is too small for this framing at ${f}mm; the camera moves in to ${(dist2(pr.pos[0], pr.pos[2], anchor[0], anchor[2])).toFixed(1)}m and cheats to ${Math.round(pr.f)}mm` });
    }
    if (n) {
      const line = sceneLine[shot.sceneIndex]!;
      const ca = sceneChars[shot.sceneIndex].get(line[0])!;
      const cb = sceneChars[shot.sceneIndex].get(line[1])!;
      const [ax, az] = ca.posAt(t0), [bx, bz] = cb.posAt(t0);
      const cross = (bx - ax) * (pos[2] - az) - (bz - az) * (pos[0] - ax);
      const both = CharTrack.disc(ca.present, t0) && CharTrack.disc(cb.present, t0);
      shot.lineSide = both && Math.abs(cross) > 0.05 ? Math.sign(cross) : 0;
    }
    return s;
  }

  const camAt = (shot: CompiledShot, local: number): Cam => {
    const s = setup(shot);
    const k = MOVE_SPEEDS[shot.speed] ?? MOVE_SPEEDS.slow;
    const u = smooth(shot.dur > 0 ? local / shot.dur : 0);
    let pos: V3 = [...s.pos];
    let aim: V3 = [...s.aim];
    let anchor: V3 = [...s.anchor];
    let f = s.f;
    const subjNow = s.subject && show.cast[s.subject] ? charAt(shot, local, s.subject) : null;
    const nowAnchor = (): V3 => subjNow ? [subjNow.x, s.body ? s.anchor[1] : eyeOf(s.subject!, subjNow), subjNow.z] : anchor;
    switch (shot.move) {
      case "push": case "pull": {
        const scale = shot.move === "push" ? 1 + k - k * u : 1 + k * u;
        pos = [anchor[0] + (pos[0] - anchor[0]) * scale, anchor[1] + (pos[1] - anchor[1]) * scale, anchor[2] + (pos[2] - anchor[2]) * scale];
        aim = aimAt(pos, anchor, s.sx, s.sy, f);
        break;
      }
      case "zoom": f = f * (1 + k * 1.5 * u); aim = aimAt(pos, anchor, s.sx, s.sy, f); break;
      case "pan": anchor = nowAnchor(); aim = aimAt(pos, anchor, s.sx, s.sy, f); break;
      case "track":
        if (subjNow) { pos = [subjNow.x + s.offset[0], pos[1], subjNow.z + s.offset[2]]; anchor = nowAnchor(); aim = aimAt(pos, anchor, s.sx, s.sy, f); }
        break;
      case "orbit": {
        const a = (k * Math.PI / 2) * u * ((shot.header.side ?? style.side) === "left" ? 1 : -1);
        const dx = pos[0] - anchor[0], dz = pos[2] - anchor[2];
        pos = [anchor[0] + dx * Math.cos(a) - dz * Math.sin(a), pos[1], anchor[2] + dx * Math.sin(a) + dz * Math.cos(a)];
        aim = aimAt(pos, anchor, s.sx, s.sy, f);
        break;
      }
      case "crane": pos[1] += k * 3 * u; aim = aimAt(pos, anchor, s.sx, s.sy, f); break;
      case "tilt": aim = [aim[0], aim[1] * (0.35 + 0.65 * u), aim[2]]; break;
      case "handheld": {
        let h = 0;
        for (const ch of shot.id) h = (h * 31 + ch.charCodeAt(0)) % 997;
        const n1 = Math.sin(local * 1.7 + h) * 0.6 + Math.sin(local * 4.1 + h * 2) * 0.4;
        const n2 = Math.sin(local * 2.3 + h * 3) * 0.6 + Math.sin(local * 5.3 + h) * 0.4;
        pos = [pos[0] + n1 * 0.012, pos[1] + n2 * 0.01, pos[2] + n2 * 0.008];
        aim = [aim[0] + n2 * 0.02, aim[1] + n1 * 0.015, aim[2]];
        break;
      }
    }
    const pr = protect(shot, local, pos, aim, f, anchor, shot.header.subjects, s.body ? 16 : 12, s.master);
    return { pos: pr.pos, target: pr.aim, fov: fovFor(pr.f) };
  };

  const compiled: Compiled = {
    show, fps, duration: r3(cut), shots, issues, charAt, propAt, camAt, presentIn, eye: eyeOf,
    geometry: (shot) => geo[shot.sceneIndex], height: (id) => castOf(id).height,
    audio: [],
  };

  // audio to cut time (trimmed regions are dropped; clipped lines are flagged)
  for (const e of audioWorld) {
    const shot = shots.find((s) => s.sceneIndex === e.sceneIndex && e.world >= s.worldStart - 1e-6 && e.world < s.worldStart + s.dur - 1e-6)
      ?? shots.find((s) => s.id === e.shot)!;
    const local = e.world - shot.worldStart;
    const inEnd = shot.dur - shot.trimTail;
    if (local + e.dur <= shot.trimHead || local >= inEnd) {
      if (e.type === "say") issues.push({ shot: shot.id, addr: e.addr, severity: "warn", check: "edit", message: `${e.char}'s line "${e.text}" is trimmed out of the cut` });
      if (e.type !== "music" && e.type !== "ambience") continue;
    }
    const start = Math.max(local, shot.trimHead);
    const out: AudioEvent = { t: r3(shot.cutStart + clamp(start, shot.trimHead, inEnd) - shot.trimHead), shot: e.shot, addr: e.addr, type: e.type, dur: e.dur };
    for (const k of ["name", "char", "text", "verb", "voice", "src", "lips"] as const) if (e[k] !== undefined) out[k] = e[k];
    if (e.type === "say" && (local < shot.trimHead - 0.05 || local + e.dur > inEnd + 0.05)) {
      out.clipped = true;
      issues.push({ shot: shot.id, addr: e.addr, severity: "warn", check: "edit", message: `the cut clips ${e.char}'s line "${e.text}"` });
    }
    compiled.audio.push(out);
  }
  // scene boundaries stop music/ambience
  for (const s of shots) {
    if (s.index > 0 && shots[s.index - 1].sceneIndex !== s.sceneIndex) {
      compiled.audio.push({ t: s.cutStart, shot: s.id, addr: s.id, type: "music", name: "stop", dur: 0 }, { t: s.cutStart, shot: s.id, addr: s.id, type: "ambience", name: "stop", dur: 0 });
    }
  }
  compiled.audio.sort((a, b) => a.t - b.t);

  // content hash per shot: everything that would be rendered, relative to the shot.
  // Unchanged hash => no re-render, no re-review, and the locality guard compares these.
  for (const s of shots) {
    setup(s);
    const h = createHash("sha1");
    h.update(JSON.stringify([s.header, s.light, s.palette, s.lens, s.move, s.speed, s.trimHead, s.trimTail, s.hold, s.dur, s.set]));
    const ids = [...sceneChars[s.sceneIndex].keys()].sort();
    const propIds = [...sceneProps[s.sceneIndex].keys()].sort();
    const step = 2 / fps;
    // sample between frames, off the grid of round numbers beat boundaries tend to land on
    for (let t = step * 0.37; t < s.dur; t += step) {
      const c = camAt(s, t);
      h.update(c.pos.map(r2).join(",") + c.target.map(r2).join(",") + r2(c.fov));
      for (const id of ids) {
        const cs = charAt(s, t, id);
        h.update(`${id}${cs.present ? 1 : 0}${r2(cs.x)},${r2(cs.z)},${r2(cs.yaw)},${r2(cs.head)},${cs.pose}${r2(cs.poseAmt)}${cs.expr}${cs.gesture >= 0 ? Math.floor(cs.gesture) : -1}${cs.talk > 0 ? 1 : 0}`);
      }
      for (const id of propIds) { const p = propAt(s, t, id); h.update(`${id}${r2(p.x)},${r2(p.y)},${r2(p.z)}${p.holder}${p.open}`); }
    }
    for (const e of audioWorld) if (e.shot === s.id) h.update(JSON.stringify([r2(e.world - s.worldStart), e.type, e.name, e.char, e.text, e.verb, r2(e.dur)]));
    s.hash = h.digest("hex").slice(0, 12);
  }

  return compiled;

  function r2(v: number) { return Math.round(v * 100) / 100; }
}

// ---------------------------------------------------------------- actions

function runAction(
  n: ActionLine, T: number, c: CharTrack, chars: Map<string, CharTrack>, props: Map<string, PropTrack>, set: SetDef,
  castOf: (id: string) => CastMember, issue: (sev: "error" | "warn", check: string, msg: string) => void,
): number {
  const v = ACTION_VERBS[n.verb];
  if (!v) return 0;
  const anchor = (name: string | null) => (name && set.anchors[name]) || null;
  const placeOf = (name: string, from: [number, number]): [number, number] | null => {
    const a = anchor(name);
    if (a) return [a.x, a.z];
    const o = chars.get(name);
    if (o && show_present(o, T)) {
      const [ox, oz] = o.posAt(T);
      const len = dist2(from[0], from[1], ox, oz) || 1;
      const k = Math.max(0, len - PHYSICS.conversationDistance) / len;
      return [from[0] + (ox - from[0]) * k, from[1] + (oz - from[1]) * k];
    }
    if (o || chars.has(name) || name) issue("error", "eyeline", `${n.actor} heads for ${name}, who isn't in the scene at this moment`);
    return null;
  };
  const faceYaw = (name: string, from: [number, number]): number | null => {
    const a = anchor(name);
    if (a) return a.face !== null && dist2(from[0], from[1], a.x, a.z) < 0.4 ? (a.face * Math.PI) / 180 : yawTo(a.x - from[0], a.z - from[1]);
    const o = chars.get(name);
    if (o) { const [ox, oz] = o.posAt(T); return yawTo(ox - from[0], oz - from[1]); }
    const p = props.get(name);
    if (p) { const pv = CharTrack.disc(p.keys, T); return yawTo(pv.x - from[0], pv.z - from[1]); }
    return null;
  };
  const walk = (t0: number, dest: [number, number], run: boolean): number => {
    const from = c.posAt(t0);
    const d = dist2(from[0], from[1], dest[0], dest[1]);
    if (d < 0.05) return 0;
    const base = n.number ?? (run ? PHYSICS.runSpeed : PHYSICS.walkSpeed);
    let D = n.dur ?? d / base;
    D = Math.max(D, 0.3);
    const heading = yawTo(dest[0] - from[0], dest[1] - from[1]);
    const swing = Math.abs(wrap(heading - c.yawAt(t0)));
    c.turn(t0, t0 + Math.max(0.25, (swing * 180) / Math.PI / PHYSICS.turnRate * 1.6), heading);
    c.move(t0, t0 + D, dest[0], dest[1]);
    const ramp = Math.min(0.35, D / 3);
    const peak = d / (D - ramp);
    c.walks.push({ t0, t1: t0 + D, speed: d / D, peak, run });
    const max = run ? PHYSICS.maxRunSpeed : PHYSICS.maxWalkSpeed;
    if (peak > max) issue("warn", "foot-slide", `${n.actor} ${run ? "runs" : "walks"} ${d.toFixed(1)}m at ${peak.toFixed(1)} m/s peak, faster than a ${run ? "run" : "walk"} cycle can sell (max ${max})`);
    if (!run && peak < PHYSICS.minWalkSpeed) issue("warn", "foot-slide", `${n.actor} walks at ${peak.toFixed(2)} m/s; reads as floating`);
    return D;
  };
  const settle = (t: number, name: string | null): number => {
    if (!name) return 0;
    const a = anchor(name);
    if (a && a.face !== null) { c.turn(t, t + 0.4, (a.face * Math.PI) / 180); return 0.4; }
    if (!a) {
      const o = chars.get(name);
      if (o) { const [ox, oz] = o.posAt(t); const [x, z] = c.posAt(t); c.turn(t, t + 0.35, yawTo(ox - x, oz - z)); return 0.35; }
    }
    return 0;
  };
  const gesture = (g: string, t0: number, d: number) => c.gest.push({ t0, t1: t0 + d, g: GESTURES.indexOf(g) });
  const near = (pid: string, t: number, what: string) => {
    const p = props.get(pid);
    if (!p) return;
    const pv = CharTrack.disc(p.keys, t);
    if (pv.holder) return;
    const [x, z] = c.posAt(t);
    const d = dist2(x, z, pv.x, pv.z);
    if (d > 1.1) issue("warn", "reach", `${n.actor} ${what} ${pid} from ${d.toFixed(1)}m away (arm's reach is ~0.8m); walk them closer first`);
  };

  switch (n.verb) {
    case "enter": {
      if (show_present(c, T - 1e-3) && !n.at) issue("warn", "continuity", `${n.actor} enters but is already on set`);
      if (!n.at) {
        const e = anchor(set.entrance);
        const p: [number, number] = e ? [e.x, e.z] : [0, set.d / 2];
        c.place(T, p[0], p[1]);
        c.yaw = c.yaw.filter((k) => k.t < T);
        c.yaw.push({ t: T, v: yawTo(-p[0], -p[1]) });
        CharTrack.put(c.present, { t: T, v: true });
      }
      let d = v.dur;
      if (n.target) {
        const dest = placeOf(n.target, c.posAt(T + d));
        if (dest) d += walk(T + d, dest, false);
        d += settle(T + d, n.target);
      }
      return d;
    }
    case "exit": {
      const target = n.target ?? set.entrance;
      const dest = placeOf(target, c.posAt(T));
      let d = dest ? walk(T, dest, false) : 0;
      d += v.dur;
      CharTrack.put(c.present, { t: T + d, v: false });
      return d;
    }
    case "walk": case "run": {
      if (!n.target) { issue("error", "grammar", `${n.verb} needs a destination`); return 0; }
      const dest = placeOf(n.target, c.posAt(T));
      if (!dest) return 0.5;
      let d = walk(T, dest, n.verb === "run");
      d += settle(T + d, n.target);
      return d;
    }
    case "sit": case "lean": case "kneel": case "stand": {
      let d = 0;
      if (n.target) {
        const dest = placeOf(n.target, c.posAt(T));
        if (dest) d += walk(T, dest, false);
        d += settle(T + d, n.target);
      }
      const pose = POSES.indexOf(n.verb === "stand" ? "stand" : n.verb);
      const pd = n.dur ?? v.dur;
      c.setPose(T + d, T + d + Math.min(pd, 1.2), pose);
      return d + pd;
    }
    case "turn": {
      if (!n.target) return 0;
      const from = c.posAt(T);
      const y = faceYaw(n.target, from);
      if (y === null) return 0;
      const amount = Math.abs(wrap(y - c.yawAt(T)));
      const d = n.dur ?? Math.max(0.35, (amount * 180) / Math.PI / PHYSICS.turnRate + 0.2);
      c.turn(T, T + d, y);
      return d;
    }
    case "open": case "close": {
      if (n.target) {
        near(n.target, T, n.verb === "open" ? "opens" : "closes");
        const p = props.get(n.target);
        if (p) { const pv = CharTrack.disc(p.keys, T); CharTrack.put(p.keys, { t: T + 0.4, v: { ...pv, open: n.verb === "open" } }); }
      }
      const d = n.dur ?? v.dur;
      gesture("reach", T, Math.min(d, 1));
      return d;
    }
    case "take": {
      const d = n.dur ?? v.dur;
      const p = n.target ? props.get(n.target) : null;
      if (p && n.target) {
        const pv = CharTrack.disc(p.keys, T);
        if (pv.holder && pv.holder !== n.actor) issue("error", "continuity", `${n.actor} takes ${n.target} but ${pv.holder} is holding it`);
        near(n.target, T, "takes");
        CharTrack.put(p.keys, { t: T + d * 0.5, v: { ...pv, holder: n.actor } });
      }
      gesture("reach", T, d);
      return d;
    }
    case "give": {
      const d = n.dur ?? v.dur;
      const p = n.target ? props.get(n.target) : null;
      if (p && n.target && n.target2) {
        const pv = CharTrack.disc(p.keys, T);
        if (pv.holder !== n.actor) issue("error", "continuity", `${n.actor} gives ${n.target} but ${pv.holder ? pv.holder + " is holding it" : "isn't holding it"}`);
        const o = chars.get(n.target2);
        if (!o || !show_present(o, T)) issue("error", "continuity", `${n.target2} isn't here to receive ${n.target}`);
        else {
          const [x, z] = c.posAt(T), [ox, oz] = o.posAt(T);
          if (dist2(x, z, ox, oz) > 1.6) issue("warn", "reach", `${n.actor} hands ${n.target} to ${n.target2} from ${dist2(x, z, ox, oz).toFixed(1)}m away`);
        }
        CharTrack.put(p.keys, { t: T + d * 0.6, v: { ...pv, holder: n.target2 } });
      }
      gesture("reach", T, d);
      return d;
    }
    case "put": {
      const d = n.dur ?? v.dur;
      const p = n.target ? props.get(n.target) : null;
      if (p && n.target) {
        const pv = CharTrack.disc(p.keys, T);
        if (pv.holder !== n.actor) issue("error", "continuity", `${n.actor} puts down ${n.target} without holding it`);
        const a = anchor(n.target2);
        const [x, z] = c.posAt(T);
        const yaw = c.yawAt(T);
        const spot = a ? { x: a.x + Math.sin(yaw) * 0.3, y: a.furniture ? topHeight(a.furniture) ?? 0.9 : 0.9, z: a.z + Math.cos(yaw) * 0.3 } : { x: x + Math.sin(yaw) * 0.45, y: 0.9, z: z + Math.cos(yaw) * 0.45 };
        CharTrack.put(p.keys, { t: T + d * 0.6, v: { ...pv, holder: null, ...spot } });
      }
      gesture("reach", T, d);
      return d;
    }
    case "wait": return n.dur ?? v.dur;
    case "look": case "glare": {
      if (n.target) CharTrack.put(c.look, { t: T, v: n.target });
      if (n.verb === "glare") CharTrack.put(c.expr, { t: T, v: "angry" });
      return n.dur ?? v.dur;
    }
    default: {
      const d = n.dur ?? v.dur;
      if (v.expression) CharTrack.put(c.expr, { t: T, v: EXPRESSIONS.includes(n.verb) ? n.verb : "neutral" });
      if (GESTURES.includes(n.verb)) gesture(n.verb, T, Math.min(d, n.verb === "blink" ? 0.3 : 1.4));
      if (n.target) CharTrack.put(c.look, { t: T, v: n.target });
      return d;
    }
  }
  function show_present(t: CharTrack, at: number) { return CharTrack.disc(t.present, at); }
}

// ---------------------------------------------------------------- baking for the browser

export interface Baked {
  fps: number;
  duration: number;
  style: { twos: boolean; asl: number };
  cast: Record<string, { name: string; height: number; color: string; voice: string; model: string | null }>;
  sets: Record<string, { w: number; d: number; h: number; open: boolean; boxes: Box[]; anchors: { id: string; x: number; z: number; face: number | null; furniture: string | null }[]; props: { id: string; kind: string | null }[] }>;
  palettes: typeof PALETTES;
  expressions: string[];
  gestures: string[];
  shots: (Omit<CompiledShot, "header"> & {
    type: string; subjects: string[];
    cam: number[][]; // per frame: px py pz tx ty tz fov
    chars: Record<string, number[][]>; // per frame: present x z yaw head pose poseAmt expr talk gesture walk
    props: Record<string, number[][]>; // per frame: x y z holder(-1) open
  })[];
  audio: AudioEvent[];
}

export function bake(c: Compiled): Baked {
  const show = c.show;
  const exprIdx = (e: string) => Math.max(0, ["neutral", ...EXPRESSIONS.filter((x) => x !== "neutral")].indexOf(e));
  const castIds = Object.keys(show.cast);
  const out: Baked = {
    fps: c.fps, duration: c.duration, style: { twos: show.style.twos, asl: show.style.asl },
    cast: Object.fromEntries(Object.values(show.cast).map((m) => [m.id, { name: m.name, height: m.height, color: m.color, voice: m.voice, model: m.model }])),
    sets: Object.fromEntries(Object.values(show.sets).map((s) => [s.id, {
      w: s.w, d: s.d, h: setGeometry(s).h, open: !!s.open, boxes: setGeometry(s).boxes,
      anchors: Object.values(s.anchors).map((a) => ({ id: a.id, x: a.x, z: a.z, face: a.face, furniture: a.furniture })),
      props: Object.values(s.props).map((p) => ({ id: p.id, kind: p.kind })),
    }])),
    palettes: PALETTES,
    expressions: ["neutral", ...EXPRESSIONS.filter((x) => x !== "neutral")],
    gestures: GESTURES,
    shots: [],
    audio: c.audio,
  };
  const r = (v: number) => Math.round(v * 1000) / 1000;
  for (const s of c.shots) {
    const frames = Math.max(1, Math.round(s.cutDur * c.fps));
    const inEnd = s.dur - s.trimTail;
    const cam: number[][] = [];
    const chars: Record<string, number[][]> = {};
    const props: Record<string, number[][]> = {};
    const ids = c.presentIn(s);
    const set = show.sets[s.set];
    for (const id of ids) chars[id] = [];
    for (const p of Object.keys(set?.props ?? {})) props[p] = [];
    for (let f = 0; f < frames; f++) {
      const local = Math.min(s.trimHead + f / c.fps, inEnd);
      const cm = c.camAt(s, local);
      cam.push([...cm.pos.map(r), ...cm.target.map(r), r(cm.fov)]);
      // characters animate on twos: hold every other frame
      const fl = show.style.twos ? f - (f % 2) : f;
      const lc = Math.min(s.trimHead + fl / c.fps, inEnd);
      for (const id of ids) {
        const cs = c.charAt(s, lc, id);
        chars[id].push([cs.present ? 1 : 0, r(cs.x), r(cs.z), r(cs.yaw), r(cs.head), cs.pose, r(cs.poseAmt), exprIdx(cs.expr), r(cs.talk), r(cs.gesture), r(cs.walk)]);
      }
      for (const p of Object.keys(props)) {
        const ps = c.propAt(s, lc, p);
        props[p].push([r(ps.x), r(ps.y), r(ps.z), ps.holder ? castIds.indexOf(ps.holder) : -1, ps.open ? 1 : 0]);
      }
    }
    const { header, ...rest } = s;
    out.shots.push({ ...rest, type: header.type, subjects: header.subjects, cam, chars, props });
  }
  return out;
}

/** Map an episode timestamp (cut time) to a shot and a local time. */
export function locate(c: Compiled, t: number): { shot: CompiledShot; local: number } | null {
  for (const s of c.shots) if (t >= s.cutStart && t < s.cutStart + s.cutDur) return { shot: s, local: s.trimHead + (t - s.cutStart) };
  const last = c.shots[c.shots.length - 1];
  return last ? { shot: last, local: last.dur } : null;
}
