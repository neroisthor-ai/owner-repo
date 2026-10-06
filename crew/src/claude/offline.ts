// The offline crew: a deterministic, rule-based stand-in for Claude with the
// exact same interface and output schemas. It keeps Crew usable with no API key
// and makes the whole pipeline testable. It is deliberately simple: it knows
// craft heuristics, not story. Real taste comes from Claude.

import type { BodyNode } from "../scene/ast.ts";
import { AMBIENCE, MUSIC_CUES, SFX, SIZE_ORDER, type RoleId } from "../scene/registry.ts";
import type { DirectCtx, ProposeCtx, RouteCtx, ScreenCtx, ShotCtx } from "../crew/context.ts";
import type { RawOp, RawTake, RawTakes } from "../crew/schema.ts";
import type { LLM, LLMCall, LLMResult } from "./llm.ts";

const has = (s: string, words: string[]) => words.some((w) => new RegExp(`\\b${w}`, "i").test(s));

const KEYWORDS: Record<Exclude<RoleId, "director">, string[]> = {
  editor: ["long", "short", "drag", "pace", "pacing", "tighten", "trim", "linger", "breathe", "rhythm", "quicker", "cut", "hold on", "lose", "drop", "slow"],
  dp: ["closer", "tighter", "wider", "angle", "camera", "lens", "frame", "framing", "side", "reverse", "claustrophobic", "intimate", "inside", "head", "pov", "ots", "push", "static", "handheld", "see", "shot", "leaves frame", "out of frame"],
  blocking: ["clip", "bump", "collide", "walk", "path", "position", "stand", "sit", "cross", "enter", "exit", "intersect", "through", "route", "blocking", "move"],
  animator: ["react", "reaction", "expression", "face", "smile", "bigger", "subtle", "eyeline", "look", "eyes", "performance", "surprise", "shock", "over the top", "too much", "sell"],
  sound: ["music", "sound", "sfx", "quiet", "silence", "silent", "loud", "noise", "ambience", "score", "audio", "hear"],
  writer: ["line", "dialogue", "says", "word", "wordy", "joke", "funnier", "rewrite", "wording", "say"],
};

export class OfflineLLM implements LLM {
  readonly mode = "offline" as const;

  async call<T = unknown>(c: LLMCall): Promise<LLMResult<T>> {
    const t0 = Date.now();
    const ok = (data: unknown): LLMResult<T> => ({
      ok: true, data: data as T, text: JSON.stringify(data), model: `offline-${c.tier}`, tier: c.tier,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, ms: Date.now() - t0,
    });
    const fail = (error: string): LLMResult<T> => ({ ...ok(null), ok: false, error });
    switch (c.task) {
      case "route": return ok(route(c.context as RouteCtx));
      case "propose": return ok(propose(c.context as ProposeCtx));
      case "refine": return ok(refine(c.context as ProposeCtx));
      case "direct": return ok(direct(c.context as DirectCtx));
      case "screen": return ok(screen(c.context as ScreenCtx));
      case "write": return fail("the writers' room needs Claude: set ANTHROPIC_API_KEY (offline mode can't write dialogue)");
    }
  }
}

// ---------------------------------------------------------------- routing

function route(c: RouteCtx) {
  const n = c.note.toLowerCase();
  const scores = Object.entries(KEYWORDS).map(([role, words]) => [role, words.filter((w) => n.includes(w)).length] as const);
  const refIssues = c.issues.filter((i) => i.shot && c.refs.includes(i.shot));
  const bump = (role: string, k: number) => { const s = scores.find(([r]) => r === role); if (s) (s as unknown as [string, number])[1] += k; };
  if (/clip|intersect|collid|bump|through/.test(n) || refIssues.some((i) => i.check === "intersection")) bump("blocking", 3);
  if (/frame/.test(n) || refIssues.some((i) => i.check === "framing")) bump("dp", 2);
  if (/too (long|short)|drag|pac/.test(n)) bump("editor", 2);
  if (/(line|dialogue).*(long|short|wordy)/.test(n)) bump("writer", 3);
  const ranked = [...scores].sort((a, b) => b[1] - a[1]);
  const roles: string[] = ranked[0][1] > 0 ? [ranked[0][0]] : ["editor"];
  const held = c.shots.filter((s) => c.refs.includes(s.id)).some((s) => s.body.some((b) => b.node.kind === "action" && (b.node.dur ?? 0) >= 1.5));
  if (roles[0] === "editor" && /too long|drag|slow/.test(n) && held) roles.push("animator");
  return { shots: c.refs, roles, intent: c.note.trim() };
}

// ---------------------------------------------------------------- helpers

const action = (actor: string, verb: string, extra: Partial<{ with: boolean; at: string | null; target: string | null; target2: string | null; number: number | null; dur: number | null }> = {}) => ({
  kind: "action", with: false, actor, at: null, verb, target: null, target2: null, number: null, dur: null, ...extra,
});
const r1 = (v: number) => Math.round(v * 10) / 10;

function lastAddr(s: ShotCtx): string {
  return s.body.length ? s.body[s.body.length - 1].addr : s.id;
}
function headerLine(s: ShotCtx, patch: Partial<ShotCtx["header"]>) {
  const h = { ...s.header, ...patch };
  return { kind: "shot", id: h.id, type: h.type, subjects: h.subjects, move: h.move, speed: h.speed, lens: h.lens, angle: h.angle, side: h.side };
}
function mentioned(c: ProposeCtx, s: ShotCtx): string | null {
  const n = c.note.toLowerCase();
  for (const [id, m] of Object.entries(c.show.cast)) if (n.includes(id) || n.includes(m.name.toLowerCase())) return id;
  return s.header.subjects.find((x) => c.show.cast[x]) ?? s.cast[0] ?? null;
}
const otherThan = (s: ShotCtx, id: string | null) => s.present.find((x) => x !== id) ?? null;
const exprBeats = (s: ShotCtx) => s.body.filter((b) => b.node.kind === "action" && ["smile", "laugh", "frown", "shock", "sad", "angry", "scared", "guilty", "think", "cry", "glare"].includes(b.node.verb));

// ---------------------------------------------------------------- proposals

function propose(c: ProposeCtx): RawTakes {
  const s = c.targets[0];
  const out: RawTakes = { takes: [], pushback: null, idea: null };
  if (!s) return out;
  const n = c.note.toLowerCase();
  const takes = out.takes;
  const add = (purpose: string, ops: RawOp[]) => { if (ops.length) takes.push({ purpose, ops }); };

  switch (c.role) {
    case "editor": {
      const trim = s.body.find((b) => b.node.kind === "edit" && b.node.verb === "trim");
      const holdL = s.body.find((b) => b.node.kind === "edit" && b.node.verb === "hold");
      const put = (line: Record<string, unknown>, existing: typeof trim): RawOp => existing ? { op: "replace", addr: existing.addr, line } : { op: "insert", addr: lastAddr(s), line };
      if (has(n, ["too short", "breathe", "linger", "hold", "longer", "let it sit", "rushed"])) {
        add("Hold on the end so the moment can land", [put({ kind: "edit", verb: "hold", a: 0.8, b: null }, holdL)]);
        add("Hold longer: let the silence do the work", [put({ kind: "edit", verb: "hold", a: 1.5, b: null }, holdL)]);
        if (trim) add("Give back the trimmed frames", [{ op: "delete", addr: trim.addr, line: null }]);
      } else {
        const lastEnd = Math.max(0, ...s.beats.filter((b) => b.kind !== "sound").map((b) => b.t1));
        const firstKey = s.beats.find((b) => b.kind === "dialogue" || b.kind === "action");
        const deadTail = r1(Math.max(0, s.dur - lastEnd - 0.1));
        // come in on the first beat that matters: skip a leading turn/look if there is one
        const lead = s.beats.find((b, i) => i > 0 && b.t0 > 0.2);
        const head = r1(Math.min(lead ? lead.t0 - 0.15 : 0, s.dur * 0.25));
        const curHead = trim?.node.kind === "edit" ? trim.node.a : 0;
        if (deadTail >= 0.15) add("Cut out on the last beat: lose the dead air at the tail", [put({ kind: "edit", verb: "trim", a: curHead, b: deadTail }, trim)]);
        if (head >= 0.2 && firstKey) add("Come in late: start on the reaction, not the set-up", [put({ kind: "edit", verb: "trim", a: head, b: deadTail }, trim)]);
        if (has(n, ["lose", "drop", "don't need", "cut it", "remove"]) || c.seed > 0) add(`Drop ${s.id}: the scene plays without it`, [{ op: "delete", addr: s.id, line: null }]);
      }
      break;
    }
    case "dp": {
      const h = s.header;
      const subj = mentioned(c, s);
      const other = otherThan(s, subj);
      const sizeIdx = SIZE_ORDER.indexOf(h.type);
      const tighter = sizeIdx > 0 ? SIZE_ORDER[sizeIdx - 1] : sizeIdx === 0 ? "ECU" : "CU";
      const wider = sizeIdx >= 0 && sizeIdx < SIZE_ORDER.length - 1 ? SIZE_ORDER[sizeIdx + 1] : "WS";
      const single = (type: string) => ({ type, subjects: subj ? [subj] : h.subjects.slice(-1) });
      const rep = (purpose: string, patch: Partial<ShotCtx["header"]>) => add(purpose, [{ op: "replace", addr: s.id, line: headerLine(s, patch) }]);
      const frameIssue = c.issues.find((i) => i.check === "framing" && i.shot === s.id);
      if (frameIssue || has(n, ["leaves frame", "out of frame", "lose him", "lose her", "follow"])) {
        rep("Pan with them so they never leave frame", { move: "pan", speed: null });
        rep("Track alongside them: keep the size, feel the move", { move: "track", speed: null });
        rep("Go wider and stay locked off", { type: wider, move: h.move });
      } else if (has(n, ["inside", "head", "subjective", "pov", "her eyes", "his eyes"]) && subj && other) {
        rep(`See it through ${subj}'s eyes`, { type: "POV", subjects: [subj, other], move: null, speed: null });
        rep(`Push into ${subj} so we're with them, not watching them`, { ...single(tighter === "ECU" && sizeIdx < 0 ? "CU" : tighter), move: "push", speed: "slow" });
        rep(`Long lens on ${subj}: the room falls away`, { ...single("CU"), lens: 85 });
      } else if (has(n, ["side", "reverse", "from his", "from her", "their side"]) && subj) {
        const partner = h.subjects.length === 2 ? h.subjects.find((x) => x !== subj) ?? other : other;
        const already = h.type === "OTS" && h.subjects[0] === subj;
        if (partner && !already) rep(`Over ${subj}'s shoulder, so we play it from their side`, { type: "OTS", subjects: [subj, partner] });
        if (partner) rep(`${subj}'s point of view on ${partner}`, { type: "POV", subjects: [subj, partner], move: null, speed: null });
        if (partner) rep(`Stay on ${subj}'s face while ${partner} talks: it's their reaction that matters`, { type: "MCU", subjects: [subj] });
      } else if (has(n, ["wider", "context", "geography", "room", "see where"])) {
        rep("One size wider so we read the geography", { type: wider });
        if (s.present.length >= 2) rep("Two-shot: let us see both of them react", { type: "TWO", subjects: s.present.slice(0, 2) });
      } else if (has(n, ["handheld", "nervous", "chaotic", "dynamic", "alive", "flat", "static"])) {
        rep("Handheld: let the frame breathe with the nerves", { move: "handheld", speed: null });
        rep("Slow push to build the pressure", { move: "push", speed: "slow" });
      } else {
        rep(`One size tighter on ${subj ?? "the subject"}`, h.type in { OTS: 1, POV: 1, TWO: 1 } ? { ...single("MCU") } : { type: tighter });
        rep("Same size, slow push in", { move: "push", speed: "slow" });
        if (has(n, ["claustrophobic", "trapped", "pressure", "closer", "tighter", "intimate"])) rep("Long lens, tight: compress the space around them", { ...single("CU"), lens: 85 });
      }
      break;
    }
    case "blocking": {
      const inter = c.issues.find((i) => i.check === "intersection" && i.shot === s.id);
      const walks = s.body.filter((b) => b.node.kind === "action" && ["walk", "run", "enter", "exit"].includes(b.node.verb) && b.node.target);
      if (inter || has(n, ["clip", "bump", "collide", "through", "intersect", "path", "route"])) {
        const set = c.show.sets[s.set];
        const anchors = Object.keys(set?.anchors ?? {});
        for (const w of walks) {
          const a = w.node as Extract<BodyNode, { kind: "action" }>;
          const idx = s.body.indexOf(w);
          const before = idx > 0 ? s.body[idx - 1].addr : s.id;
          for (const via of anchors) {
            if (via === a.target || via === a.at) continue;
            add(`Route ${a.actor} via the ${via} so the path clears everyone`, [{ op: "insert", addr: before, line: action(a.actor, a.verb === "run" ? "run" : "walk", { target: via, number: a.number }) }]);
          }
        }
      } else if (has(n, ["faster", "hurry", "rush"])) {
        for (const w of walks) {
          const a = w.node as Extract<BodyNode, { kind: "action" }>;
          add(`${a.actor} moves with urgency`, [{ op: "replace", addr: w.addr, line: action(a.actor, a.verb, { at: a.at, target: a.target, number: 1.8, with: a.with }) }]);
        }
      } else if (has(n, ["slower", "sneak", "creep", "careful"])) {
        for (const w of walks) {
          const a = w.node as Extract<BodyNode, { kind: "action" }>;
          add(`${a.actor} creeps: every step costs something`, [{ op: "replace", addr: w.addr, line: action(a.actor, a.verb, { at: a.at, target: a.target, number: 0.8, with: a.with }) }]);
        }
      }
      // keep the fan-out manageable but let the guard pick
      takes.splice(8);
      break;
    }
    case "animator": {
      const ex = exprBeats(s);
      const bigger: Record<string, string> = { smile: "laugh", frown: "angry", think: "shock", guilty: "scared", sad: "cry", shock: "scared" };
      const smaller: Record<string, string> = { laugh: "smile", angry: "frown", shock: "think", scared: "guilty", cry: "sad", glare: "frown" };
      const main = ex.sort((a, b) => ((b.node as { dur: number | null }).dur ?? 1) - ((a.node as { dur: number | null }).dur ?? 1))[0];
      const m = main?.node as Extract<BodyNode, { kind: "action" }> | undefined;
      if (has(n, ["look", "eyeline", "eyes", "looking"]) || c.issues.some((i) => i.check === "eyeline" && i.shot === s.id)) {
        const subj = mentioned(c, s) ?? s.cast[0];
        const other = otherThan(s, subj);
        if (subj && other) {
          add(`${subj} keeps their eyes on ${other}`, [{ op: "insert", addr: s.id, line: action(subj, "look", { target: other }) }]);
          add(`${subj} looks away from ${other}, then back`, [{ op: "insert", addr: s.id, line: action(subj, "look", { target: other, dur: 1 }) }]);
        }
      } else if (m && main && has(n, ["subtle", "less", "smaller", "too much", "over the top", "big", "tone"]) && !has(n, ["bigger"])) {
        add("Same reaction, half the hold: let it flicker", [{ op: "replace", addr: main.addr, line: action(m.actor, m.verb, { at: m.at, with: m.with, target: m.target, dur: r1(Math.max(0.6, (m.dur ?? 1.2) * 0.5)) }) }]);
        if (smaller[m.verb]) add(`Play it as ${smaller[m.verb]} instead of ${m.verb}`, [{ op: "replace", addr: main.addr, line: action(m.actor, smaller[m.verb], { at: m.at, with: m.with, dur: m.dur }) }]);
        add("Swap the reaction for a slow blink", [{ op: "replace", addr: main.addr, line: action(m.actor, "blink", { at: m.at, with: m.with }) }]);
      } else if (m && main && has(n, ["too long", "drag", "shorter", "faster"])) {
        add(`Shorten the ${m.verb} hold`, [{ op: "replace", addr: main.addr, line: action(m.actor, m.verb, { at: m.at, with: m.with, target: m.target, dur: r1(Math.max(0.6, (m.dur ?? 1.2) * 0.5)) }) }]);
        add(`Cut the ${m.verb} beat entirely`, [{ op: "delete", addr: main.addr, line: null }]);
      } else if (m && main) {
        add("Hold the reaction longer so it reads", [{ op: "replace", addr: main.addr, line: action(m.actor, m.verb, { at: m.at, with: m.with, target: m.target, dur: r1((m.dur ?? 1.2) * 1.5) }) }]);
        if (bigger[m.verb]) add(`Push it: ${bigger[m.verb]} instead of ${m.verb}`, [{ op: "replace", addr: main.addr, line: action(m.actor, bigger[m.verb], { at: m.at, with: m.with, dur: m.dur }) }]);
        add(`Add a sigh on the back of the ${m.verb}`, [{ op: "insert", addr: main.addr, line: action(m.actor, "sigh", { with: true }) }]);
      }
      break;
    }
    case "sound": {
      const firstBeat = s.body.find((b) => !["comment", "light", "edit"].includes(b.node.kind));
      const lastBeat = [...s.body].reverse().find((b) => !["comment", "light", "edit"].includes(b.node.kind));
      const cue = Object.keys(MUSIC_CUES).find((k) => k !== "stop" && n.includes(k)) ?? (has(n, ["tension", "scary"]) ? "tense" : has(n, ["sweet", "heart", "warm"]) ? "warm" : null);
      const sfx = Object.keys(SFX).find((k) => n.includes(k.split(".")[0]));
      const ins = (at: typeof firstBeat, line: Record<string, unknown>): RawOp[] => at ? [{ op: "insert", addr: at.addr, line }] : [];
      if (has(n, ["silence", "silent", "quiet", "breathe", "no music", "too much music"])) {
        add("Drop everything out for a beat", ins(lastBeat, { kind: "sound", with: false, verb: "silence", name: null, dur: 1 }));
        add("Kill the music under this moment", ins(firstBeat, { kind: "sound", with: true, verb: "music", name: "stop", dur: null }));
      } else if (cue || has(n, ["music", "score"])) {
        const k = cue ?? "warm";
        add(`Bring in the ${k} cue on the first beat`, ins(firstBeat, { kind: "sound", with: true, verb: "music", name: k, dur: null }));
        add(`Hold the ${k} cue back until the last beat`, ins(lastBeat, { kind: "sound", with: true, verb: "music", name: k, dur: null }));
      } else if (sfx) {
        add(`Put a ${sfx} under the first beat`, ins(firstBeat, { kind: "sound", with: true, verb: "sfx", name: sfx, dur: null }));
      } else if (has(n, ["ambience", "room", "empty", "dead"])) {
        const amb = Object.keys(AMBIENCE).find((k) => n.includes(k)) ?? "room";
        add(`Lay a ${amb} bed under the shot`, ins(firstBeat, { kind: "sound", with: true, verb: "ambience", name: amb, dur: null }));
      }
      break;
    }
    case "writer": {
      const lines = s.body.filter((b) => b.node.kind === "dialogue");
      const longest = lines.sort((a, b) => (b.node as { text: string }).text.length - (a.node as { text: string }).text.length)[0];
      if (longest && has(n, ["short", "wordy", "long", "tight", "cut", "trim", "less"])) {
        const d = longest.node as Extract<BodyNode, { kind: "dialogue" }>;
        const first = d.text.match(/^[^.,;!?—…]+[.,;!?—…]*/)?.[0].replace(/[,;—]+$/, ".") ?? d.text;
        const words = d.text.split(/\s+/);
        if (first !== d.text) add("Say only the first thought", [{ op: "replace", addr: longest.addr, line: { ...d, kind: "dialogue", text: first.trim() } }]);
        if (words.length > 3) add("Lose the last few words", [{ op: "replace", addr: longest.addr, line: { ...d, kind: "dialogue", text: words.slice(0, Math.max(2, Math.ceil(words.length * 0.6))).join(" ").replace(/[,;]$/, "") + "." } }]);
      } else {
        out.pushback = "The offline crew can only shorten lines. New dialogue needs Claude (set ANTHROPIC_API_KEY).";
      }
      break;
    }
  }
  if (!takes.length && !out.pushback) out.pushback = `The offline ${c.role} has no heuristic for this note. Connect Claude for open-ended notes.`;
  if (c.seed > 0) takes.reverse();
  return out;
}

function refine(c: ProposeCtx): RawTakes {
  const takes: RawTake[] = (c.candidates ?? []).slice(0, 3);
  return { takes, pushback: null, idea: null };
}

function direct(c: DirectCtx) {
  const letters = "ABC";
  const lines = c.takes.map((t, i) => `Take ${letters[i]}: ${t.purpose}${t.fixed ? ` (clears ${t.fixed} QC issue${t.fixed > 1 ? "s" : ""})` : ""}.`);
  const message = c.takes.length
    ? `${c.takes.length} take${c.takes.length > 1 ? "s" : ""}, all local to ${[...new Set(c.takes.flatMap((t) => t.changed))].join(", ")}. I'd go with A. ${lines.join(" ")}`
    : "No take survived the checks.";
  return { message, order: c.takes.map((_, i) => i), pushback: c.pushback, idea: c.idea };
}

function screen(c: ScreenCtx) {
  const avg = c.shots.reduce((a, s) => a + s.cutDur, 0) / Math.max(1, c.shots.length);
  return {
    wants: "(offline screening reads pacing only, not story)",
    understood: false,
    shots: c.shots.map((s) => ({
      id: s.id,
      boredom: Math.min(3, Math.max(0, Math.round((s.cutDur / avg - 1) * 2 + (s.lines === 0 && s.moves === 0 && s.reactions === 0 ? 1 : 0)))),
      confusion: s.lines === 0 && s.moves === 0 && s.reactions === 0 ? 1 : 0,
      note: s.cutDur > avg * 1.8 ? "long for this cut" : null,
    })),
  };
}
