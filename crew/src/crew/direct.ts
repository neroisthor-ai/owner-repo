// A note goes in, 1-3 takes come out.
//
//   route (Haiku)  ->  plan (Opus, only if the note is ambiguous)  ->  build (Sonnet, one call per role)
//   ->  code filter (permissions, grammar, locality guard, QC)  ->  retry (Sonnet, sees why it failed)
//   ->  debug (Opus, only if both Sonnet passes failed)  ->  pick and explain (Opus, only if the takes are close or one adds issues)
//
// Opus is the expensive one, so most notes never touch it: Haiku routes, Sonnet builds, code checks.

import type { Compiled } from "../scene/compile.ts";
import { locate } from "../scene/compile.ts";
import { printPatch, type PatchOp } from "../scene/patch.ts";
import type { RoleId } from "../scene/registry.ts";
import type { LLM, LLMCall, LLMResult } from "../claude/llm.ts";
import type { NoteRecord, Project, TakeRecord } from "../project.ts";
import { evaluate, type Evaluation } from "./guard.ts";
import { listing, proposePrompt, stableSystem } from "./prompts.ts";
import { CRAFT_ROLES, ROLES, type Tier } from "./roles.ts";
import { directorSchema, planSchema, routeSchema, takesSchema, toOps, type RawTake, type RawTakes } from "./schema.ts";
import type { DirectCtx, ProposeCtx, RouteCtx, ShotCtx } from "./context.ts";
import { structure } from "../scene/parse.ts";

export interface CrewEvent {
  kind: "step" | "call" | "filter" | "done" | "error";
  role?: string;
  tier?: Tier;
  model?: string;
  message: string;
  cost?: number;
  tokens?: number;
  ms?: number;
}

export interface CrewOptions {
  llm: LLM;
  emit?: (e: CrewEvent) => void;
  /** the note this one follows up (counts as round 2+) */
  parent?: string;
}

interface Candidate { raw: RawTake; ops: PatchOp[]; ev: Evaluation; tier: Tier; model: string; role: RoleId; score: number }

export interface Refs { shots: string[]; times: { shot: string; local: number }[] }

/** Find shot ids ("4G", "1d") and timestamps ("0:03", "4G 0:03") in a note. */
export function parseRefs(note: string, c: Compiled): Refs {
  const ids = new Map(c.shots.map((s) => [s.id.toUpperCase(), s.id]));
  const refs: Refs = { shots: [], times: [] };
  const push = (id: string) => { if (!refs.shots.includes(id)) refs.shots.push(id); };
  let rest = note.replace(/(?:\b(\d+[A-Za-z]*)\s+)?(?:at\s+)?\b(\d+):(\d{2}(?:\.\d+)?)\b/g, (_m, id: string | undefined, mm: string, ss: string) => {
    const secs = Number(mm) * 60 + Number(ss);
    const shot = id ? ids.get(id.toUpperCase()) : undefined;
    if (shot) {
      const s = c.shots.find((x) => x.id === shot)!;
      refs.times.push({ shot, local: s.trimHead + secs });
      push(shot);
    } else {
      const hit = locate(c, secs);
      if (hit) { refs.times.push({ shot: hit.shot.id, local: hit.local }); push(hit.shot.id); }
      if (id && !shot) return ` ${id} `;
    }
    return " ";
  });
  rest = rest.replace(/\b(\d+[A-Za-z]*)\b/g, (m) => { const id = ids.get(m.toUpperCase()); if (id) push(id); return " "; });
  return refs;
}

export function shotCtx(p: Project, ids: string[]): ShotCtx[] {
  const st = structure(p.ws.doc);
  const c = p.ws.compiled;
  return ids.flatMap((id) => {
    const b = st.shots.find((s) => s.id === id);
    const s = c.shots.find((x) => x.id === id);
    if (!b || !s) return [];
    const present = c.presentIn(s);
    const cast = [...new Set([...b.header.subjects.filter((x) => p.show.cast[x]), ...b.body.flatMap((l) => ("actor" in l.node ? [l.node.actor] : [])), ...present])];
    return [{ id, header: b.header, body: b.body.map((l) => ({ addr: l.addr, node: l.node })), dur: s.dur, cutDur: s.cutDur, trimHead: s.trimHead, trimTail: s.trimTail, hold: s.hold, present, set: s.set, cast, beats: s.beats.map((x) => ({ addr: x.addr, t0: x.t0, t1: x.t1, kind: x.kind })) }];
  });
}

export async function directNote(p: Project, note: string, o: CrewOptions): Promise<NoteRecord> {
  const t0 = Date.now();
  const emit = o.emit ?? (() => {});
  const system = stableSystem(p.showSrc);
  const ws = p.ws;
  const rec: NoteRecord = {
    id: p.id("n"), at: new Date().toISOString(), note, targets: [], roles: [], intent: note, takes: [], message: "", pushback: null, idea: null,
    rejected: [], status: "open", round: 1, cost: 0, tokens: 0, ms: 0, mode: o.llm.mode,
  };
  if (o.parent) {
    const parent = p.notes.find((n) => n.id === o.parent);
    rec.parent = o.parent;
    rec.round = (parent?.round ?? 1) + 1;
    if (parent && parent.status === "open") { parent.status = "rejected"; p.saveNote(parent); }
  }
  const call = async <T>(c: LLMCall): Promise<LLMResult<T>> => {
    emit({ kind: "call", role: c.role, tier: c.tier, message: `${c.role}: ${c.task} on ${c.tier}` });
    const r = await o.llm.call<T>(c);
    rec.cost += r.cost;
    rec.tokens += r.usage.input + r.usage.output + r.usage.cacheRead + r.usage.cacheWrite;
    emit({ kind: r.ok ? "step" : "error", role: c.role, tier: c.tier, model: r.model, message: r.ok ? `${c.role} ${c.task} done` : `${c.role} ${c.task} failed: ${r.error}`, cost: r.cost, tokens: r.usage.output, ms: r.ms });
    return r;
  };

  // ---------------------------------------------------------------- 1. route
  const refs = parseRefs(note, ws.compiled);
  const allIds = ws.compiled.shots.map((s) => s.id);
  const routeCtx: RouteCtx = { note, refs: refs.shots, shots: shotCtx(p, allIds), issues: ws.qc.issues };
  const routePrompt = `NOTE: "${note}"\nShots referenced explicitly: ${refs.shots.join(", ") || "none"}${refs.times.length ? `\nTimestamps resolved: ${refs.times.map((t) => `${t.shot} @${t.local.toFixed(1)}s`).join(", ")}` : ""}\n\nEPISODE:\n${listing(ws.doc, ws.compiled, null)}\n\nQC issues:\n${ws.qc.issues.map((i) => `- ${i.shot}: ${i.message}`).join("\n") || "none"}\n\nWhich shots is this note about, and which crew role(s) own the fix? Prefer one role. Roles: ${CRAFT_ROLES.map((r) => `${r} (${ROLES[r].owns})`).join("; ")}.`;
  let route: { shots: string[]; roles: string[]; intent: string } | null = null;
  for (const tier of ["haiku", "sonnet"] as Tier[]) {
    const r = await call<{ shots: string[]; roles: string[]; intent: string }>({ task: "route", role: "router", tier, system, prompt: routePrompt, schema: routeSchema(allIds), context: routeCtx, maxTokens: 2000 });
    if (r.ok && r.data && r.data.roles?.length) { route = r.data; break; }
  }
  // Opus plans only when the note is ambiguous: Haiku could not route it, it needs two roles, or it reaches across many shots
  let brief = "";
  const ambiguous = !route || route.roles.length > 1 || (refs.shots.length ? refs.shots.length : route.shots.length) > 3;
  if (ambiguous) {
    const pr = await call<{ shots: string[]; roles: string[]; intent: string; brief: string }>({
      task: "plan", role: "director", tier: "opus", system, schema: planSchema(allIds), context: routeCtx, maxTokens: 1500,
      prompt: `${routePrompt}\n\nA quick read said: ${route ? `shots ${route.shots.join(", ") || "none"}, roles ${route.roles.join(" + ")}, "${route.intent}"` : "it could not place this note"}.\nYou are the director. Decide the plan: which shots, which one or two roles, the goal in one sentence, and a short brief for the builder (what to do, what to leave alone).`,
    });
    if (pr.ok && pr.data?.roles?.length) { route = pr.data; brief = pr.data.brief ?? ""; }
  }
  const targets = refs.shots.length ? refs.shots : (route?.shots ?? []).filter((s) => allIds.includes(s));
  rec.targets = targets;
  rec.intent = route?.intent ?? note;
  rec.roles = [...new Set((route?.roles ?? ["editor"]).filter((r): r is RoleId => (CRAFT_ROLES as string[]).includes(r)))].slice(0, 2);
  if (!rec.roles.length) rec.roles = ["editor"];
  if (!targets.length) {
    rec.status = "needs-shot";
    rec.message = "Which shot? Give me a shot ID (like 1D) or a timestamp (like 0:12).";
    rec.ms = Date.now() - t0;
    p.saveNote(rec);
    emit({ kind: "done", message: rec.message });
    return rec;
  }
  emit({ kind: "step", role: "router", message: `note -> ${rec.roles.join(" + ")} on ${targets.join(", ")}` });

  // ---------------------------------------------------------------- 2. each role proposes, code filters, escalate on failure
  const allowed = new Set(targets);
  const taste = p.taste();
  const listingText = listing(ws.doc, ws.compiled, allowed);
  const targetIssues = ws.qc.issues.filter((i) => i.shot && allowed.has(i.shot));

  const tryTake = (raw: RawTake, role: RoleId, tier: Tier, model: string): Candidate | { reason: string } => {
    let ops: PatchOp[];
    try { ops = toOps(raw); } catch (e) { return { reason: (e as Error).message }; }
    const ev = evaluate(ws, ops, { role, allowed, requireChange: true });
    if (!ev.ok) return { reason: `${printPatch(ops).replace(/\n/g, "; ")} => ${ev.reasons[0]}` };
    const warn = (xs: typeof ev.newIssues) => xs.filter((i) => i.severity !== "info").length;
    const score = ops.length + 2 * warn(ev.newIssues) - 2 * warn(ev.fixedIssues) + 0.5 * (ev.changedShots.length - 1);
    return { raw, ops, ev, tier, model, role, score };
  };

  const dedupe = (cs: Candidate[]) => {
    const seen = new Set<string>();
    return cs.filter((c) => {
      const key = c.ev.after!.compiled.shots.filter((s) => c.ev.changedShots.includes(s.id)).map((s) => s.hash).join("|") + c.ev.changedShots.join(",");
      const purpose = "p:" + c.raw.purpose.trim().toLowerCase();
      if (seen.has(key) || seen.has(purpose)) return false;
      seen.add(key);
      seen.add(purpose);
      return true;
    });
  };

  const runRole = async (role: RoleId) => {
    const def = ROLES[role];
    const ladder = def.ladder;
    const failures: string[] = [];
    let survivors: Candidate[] = [];
    let pushback: string | null = null, idea: string | null = null;
    const ctxBase: Omit<ProposeCtx, "seed"> = { role, note, intent: rec.intent, targets: shotCtx(p, targets), issues: targetIssues, show: p.show, failures };
    for (const [rung, tier] of ladder.entries()) {
      const n = 1;
      const prompt = proposePrompt({ role, note, intent: brief ? `${rec.intent}\nDirector's brief: ${brief}` : rec.intent, targets, listingText, issues: targetIssues, taste, failures: failures.slice(-8), stage: "propose" });
      const results = await Promise.all(Array.from({ length: n }, (_, seed) => call<RawTakes>({
        task: "propose", role, tier, system, prompt, schema: takesSchema(p.show, role), effort: def.effort, context: { ...ctxBase, failures: [...failures], seed },
      })));
      const cands: Candidate[] = [];
      for (const r of results) {
        if (!r.ok || !r.data) { failures.push(r.error ?? "no output"); continue; }
        pushback = pushback ?? r.data.pushback;
        idea = idea ?? r.data.idea;
        for (const raw of r.data.takes ?? []) {
          const t = tryTake(raw, role, tier, r.model);
          if ("reason" in t) { failures.push(t.reason); rec.rejected.push({ tier, reason: t.reason }); } else cands.push(t);
        }
      }
      // if the target shots have QC errors and some takes fix them, the ones that do not are not answers
      const fixesError = (c: Candidate) => c.ev.fixedIssues.some((i) => i.severity === "error");
      const pool = targetIssues.some((i) => i.severity === "error") && cands.some(fixesError) ? cands.filter(fixesError) : cands;
      for (const c of cands) if (!pool.includes(c)) rec.rejected.push({ tier, reason: `${printPatch(c.ops).replace(/\n/g, "; ")} => passes the checks but leaves the QC error in place` });
      survivors = dedupe(pool.sort((a, b) => a.score - b.score));
      const total = results.reduce((a, r) => a + (r.data?.takes?.length ?? 0), 0);
      emit({ kind: "filter", role, tier, message: `${role}: ${survivors.length}/${total} ${tier} takes passed the checks` });
      if (!survivors.length) { if (rung < ladder.length - 1) emit({ kind: "step", role, message: ladder[rung + 1] === "opus" ? `${role}: handing it to the director to debug` : `${role}: retrying with the failures` }); continue; }

      break;
    }
    return { role, survivors: survivors.slice(0, 3), pushback, idea };
  };

  const perRole = await Promise.all(rec.roles.map(runRole));

  // ---------------------------------------------------------------- 3. combine roles
  let finals: Candidate[] = [];
  if (perRole.length === 1) finals = perRole[0].survivors;
  else {
    const [a, b] = perRole;
    const n = Math.max(a.survivors.length, b.survivors.length);
    for (let i = 0; i < n && finals.length < 3; i++) {
      const x = a.survivors[i] ?? a.survivors[0], y = b.survivors[i] ?? b.survivors[0];
      if (x && y) {
        const merged: RawTake = { purpose: `${x.raw.purpose}; ${y.raw.purpose.charAt(0).toLowerCase()}${y.raw.purpose.slice(1)}`, ops: [...x.raw.ops, ...y.raw.ops] };
        const t = tryTake(merged, "director", x.tier, x.model);
        if (!("reason" in t)) finals.push(t);
      }
    }
    if (!finals.length) finals = [...a.survivors, ...b.survivors].sort((x, y) => x.score - y.score).slice(0, 3);
  }
  finals = dedupe(finals).slice(0, 3);
  rec.pushback = perRole.map((r) => r.pushback).find(Boolean) ?? null;
  rec.idea = perRole.map((r) => r.idea).find(Boolean) ?? null;

  const letters = "ABC";
  rec.takes = finals.map((c, i): TakeRecord => ({
    id: `${rec.id}-${letters[i]}`, purpose: c.raw.purpose, patch: printPatch(c.ops), roles: [c.role], tier: c.tier, model: c.model,
    changedShots: c.ev.changedShots, fixed: c.ev.fixedIssues.map((x) => x.message), added: c.ev.newIssues.map((x) => `${x.severity}: ${x.message}`), score: Math.round(c.score * 10) / 10,
  }));

  if (!rec.takes.length) {
    rec.status = "failed";
    rec.message = `No take survived the checks (${rec.rejected.length} rejected). ${rec.pushback ?? ""}`.trim();
    rec.ms = Date.now() - t0;
    p.saveNote(rec);
    emit({ kind: "done", message: rec.message });
    return rec;
  }

  // ---------------------------------------------------------------- 4. the director chooses and explains
  const dctx: DirectCtx = {
    note, pushback: rec.pushback, idea: rec.idea,
    takes: rec.takes.map((t) => ({ purpose: t.purpose, patch: t.patch, changed: t.changedShots, fixed: t.fixed.length, added: t.added.length })),
  };
  const dPrompt = `NOTE: "${note}"\nGoal: ${rec.intent}\n\nTAKES (all passed permissions, grammar, the locality guard and QC):\n${rec.takes.map((t, i) => `Take ${i} - ${t.purpose}\n${t.patch}\nchanges: ${t.changedShots.join(", ")}; fixes ${t.fixed.length} QC issues; adds ${t.added.length}${t.added.length ? ` (${t.added.join("; ")})` : ""}`).join("\n\n")}\n\nCrew pushback: ${rec.pushback ?? "none"}\nCrew idea: ${rec.idea ?? "none"}\n\nDirector's taste so far:\n${[...taste.accepted.map((a) => "+ " + a), ...taste.rejected.map((a) => "- " + a)].join("\n") || "no history yet"}\n\nOrder the takes best first, write the message to the human director (results first, short), keep or sharpen the pushback (null if none), and give exactly one idea they didn't ask for.\n\nEPISODE CONTEXT:\n${listingText}`;
  // Opus picks only when it matters: two or more takes that are close in score, or one that adds QC issues. Otherwise code orders them by score.
  const close = rec.takes.length >= 2 && (rec.takes[1].score - rec.takes[0].score < 1.5 || rec.takes.some((t) => t.added.length));
  if (close) {
    const r = await call<{ message: string; order: number[]; pushback: string | null; idea: string | null }>({ task: "direct", role: "director", tier: "opus", system, prompt: dPrompt, schema: directorSchema, effort: ROLES.director.effort, context: dctx, maxTokens: 2500 });
    if (r.ok && r.data) {
      const order = [...new Set((r.data.order ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < rec.takes.length))];
      for (let i = 0; i < rec.takes.length; i++) if (!order.includes(i)) order.push(i);
      rec.takes = order.map((i, k) => ({ ...rec.takes[i], id: `${rec.id}-${letters[k]}` }));
      rec.message = r.data.message;
      rec.pushback = r.data.pushback ?? rec.pushback;
      rec.idea = r.data.idea ?? rec.idea;
    }
  }
  if (!rec.message) rec.message = `${rec.takes.length} take${rec.takes.length > 1 ? "s" : ""}. Recommended: ${rec.takes[0].purpose}.`;
  rec.ms = Date.now() - t0;
  p.saveNote(rec);
  emit({ kind: "done", message: rec.message, cost: rec.cost, ms: rec.ms });
  return rec;
}

/** Apply one of a note's takes. Re-checked against the current episode in case it moved on. */
export function acceptTake(p: Project, noteId: string, takeId: string) {
  const n = p.notes.find((x) => x.id === noteId);
  if (!n) throw new Error(`no note ${noteId}`);
  const t = n.takes.find((x) => x.id === takeId);
  if (!t) throw new Error(`no take ${takeId}`);
  const ev = p.check(t.patch, { role: "director", allowed: new Set(n.targets.concat(t.changedShots)), requireChange: true });
  if (!ev.ok) throw new Error(`take ${takeId} no longer applies cleanly: ${ev.reasons.join("; ")}. Re-run the note.`);
  const h = p.commit(ev, { role: t.roles[0] ?? "director", source: "crew", noteId, takeId, summary: `${n.note} -> ${t.purpose}` });
  n.status = "accepted";
  n.accepted = takeId;
  p.saveNote(n);
  return { history: h, evaluation: ev };
}

export function rejectNote(p: Project, noteId: string) {
  const n = p.notes.find((x) => x.id === noteId);
  if (!n) throw new Error(`no note ${noteId}`);
  n.status = "rejected";
  p.saveNote(n);
  return n;
}
