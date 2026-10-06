// The guided crew: the note pipeline for models far less reliable than Claude (the Gemini profile).
//
//   read the note   Lite x3, majority vote; code resolves shot ids and timestamps first and wins on conflict
//   plan            Pro, unless the note is a plain tweak that code already answers
//   candidates      code: the offline crew's moves, checked
//   build           Flash, per role: patch TEXT inside a tiny JSON envelope, with a role guide, the target lines and worked examples
//   repair          Flash, up to 2 rounds, each failure explained in plain words with the fix
//   debug           Pro, once, if Flash still has nothing that passes
//   rank            Lite x3, Borda count over everything that passed
//   review          Pro: orders, explains, says whether each take fits the plan; if none fit, one more Flash round
//
// Every model answer is treated as untrusted: shot ids, roles, indices and patches are all re-checked in code,
// and a note that the offline crew can answer never comes back empty.

import { printPatch, parsePatch, type PatchOp } from "../scene/patch.ts";
import type { RoleId } from "../scene/registry.ts";
import type { LLM, LLMCall, LLMResult } from "../claude/llm.ts";
import { OfflineLLM } from "../claude/offline.ts";
import type { NoteRecord, Project, TakeRecord } from "../project.ts";
import { evaluate, type Evaluation } from "./guard.ts";
import { issuesText, listing, stableSystem } from "./prompts.ts";
import { CRAFT_ROLES, ROLES, type Tier } from "./roles.ts";
import { planDetailSchema, rankSchema, reviewSchema, routeSchema, textTakesSchema, toOps, type RawTakes } from "./schema.ts";
import type { ProposeCtx, RouteCtx } from "./context.ts";
import { parseRefs, shotCtx, type CrewEvent, type CrewOptions } from "./direct.ts";
import { examplesFor, patchGuide, targetListing } from "./patchguide.ts";
import { explainFailure } from "./feedback.ts";
import { settingsFor } from "../llm/capability.ts";

/** Tunables, in one place so the eval can move them. Votes, examples, repairs and context come from the grip (capability.ts). */
export const GUIDED = {
  maxTakes: 3,
  /** a note that names its shot, is this short, needs one role, and that code already answers, skips the Pro plan */
  plainTweakWords: 8,
};

interface Cand { purpose: string; ops: PatchOp[]; ev: Evaluation; role: RoleId; tier: Tier | "code"; model: string; score: number }
interface Failure { role: RoleId; patch: string; why: string }

// ---------------------------------------------------------------- sanitising what the model wrote

const ADDR_LINE = /^\s*\d+[A-Z]+[A-Z]?(\.\d+)?\s+(=|\+\+|\+|-|~|\S+\s*->)/;

/**
 * Weak models wrap patches in fences, bullets, numbering, "Take A:" headings and commentary, put escaped newlines in
 * JSON strings, join ops with ";" and use curly quotes. Clean all of that before parsing; report what was dropped.
 */
export function cleanPatch(raw: string): { text: string; dropped: string[] } {
  let t = String(raw ?? "")
    .replace(/\\n/g, "\n")
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/```[a-z]*\n?/gi, "").replace(/```/g, "");
  // "1D.2 = a; 1D.3 -" on one line
  t = t.replace(/;\s+(?=\d+[A-Z]+[A-Z]?(\.\d+)?\s)/g, "\n");
  const keep: string[] = [], dropped: string[] = [];
  for (let line of t.split("\n")) {
    line = line.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+(?=\d+[A-Z]))/, "").trimEnd();
    if (!line.trim()) continue;
    if (ADDR_LINE.test(line)) keep.push(line.trim());
    else dropped.push(line.trim());
  }
  return { text: keep.join("\n"), dropped };
}

// ---------------------------------------------------------------- the pipeline

export async function guidedNote(p: Project, note: string, o: CrewOptions): Promise<NoteRecord> {
  const t0 = Date.now();
  const emit = o.emit ?? (() => {});
  const system = stableSystem(p.showSrc);
  const ws = p.ws;
  const offline = new OfflineLLM();
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
  const call = async <T>(c: LLMCall, label: string): Promise<LLMResult<T>> => {
    emit({ kind: "call", role: c.role, tier: c.tier, message: `${label} on ${c.tier}` });
    const r = await o.llm.call<T>(c);
    rec.cost += r.cost;
    rec.tokens += r.usage.input + r.usage.output + r.usage.cacheRead + r.usage.cacheWrite;
    emit({ kind: r.ok ? "step" : "error", role: c.role, tier: c.tier, model: r.model, message: r.ok ? `${label} done` : `${label} failed: ${r.error}`, cost: r.cost, tokens: r.usage.output, ms: r.ms });
    return r;
  };
  const finish = (status: NoteRecord["status"], message: string) => {
    rec.status = status;
    rec.message = message;
    rec.ms = Date.now() - t0;
    p.saveNote(rec);
    emit({ kind: "done", message: rec.message, cost: rec.cost, ms: rec.ms });
    return rec;
  };

  // how tight a grip each step gets depends on the model behind it and how hard the step is
  const modelOf = (t: Tier) => o.llm.modelFor?.(t) ?? "";
  const grip = { read: settingsFor(modelOf("haiku"), "read"), rank: settingsFor(modelOf("haiku"), "rank"), patch: settingsFor(modelOf("sonnet"), "patch") };
  emit({ kind: "step", message: `hand-holding: reading ${grip.read.grip}, ranking ${grip.rank.grip}, building ${grip.patch.grip}` });

  // ---------------------------------------------------------------- 1. read the note (code first, Lite votes)
  const refs = parseRefs(note, ws.compiled);
  const allIds = ws.compiled.shots.map((s) => s.id);
  const routeCtx: RouteCtx = { note, refs: refs.shots, shots: shotCtx(p, allIds), issues: ws.qc.issues };
  const codeRoute = (await offline.call<{ shots: string[]; roles: string[]; intent: string }>({ task: "route", role: "router", tier: "haiku", system, prompt: "", context: routeCtx })).data!;
  const routePrompt = `NOTE: "${note}"\nShots named in the note: ${refs.shots.join(", ") || "none"}${refs.times.length ? `\nTimestamps: ${refs.times.map((t) => `${t.shot} @${t.local.toFixed(1)}s`).join(", ")}` : ""}\n\nEPISODE (one line per shot):\n${listing(ws.doc, ws.compiled, null, false)}\n\nQC issues:\n${issuesText(ws.qc.issues)}\n\nWhich shots is this note about, and which ONE role owns the fix (two only if it truly needs both)?\nRoles:\n${CRAFT_ROLES.map((r) => `- ${r}: ${ROLES[r].owns}`).join("\n")}\nIf the note names shots, use exactly those.`;
  const votes = (await Promise.all(Array.from({ length: grip.read.votes }, () => call<{ shots: string[]; roles: string[]; intent: string }>({ task: "route", role: "router", tier: "haiku", system, prompt: routePrompt, schema: routeSchema(allIds), context: routeCtx, maxTokens: 1500 }, "reading the note"))))
    .filter((r) => r.ok && r.data).map((r) => r.data!);
  const tally = (xs: string[][]) => { const m = new Map<string, number>(); for (const x of xs) for (const v of new Set(x)) m.set(v, (m.get(v) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };
  const voteShots = tally(votes.map((v) => (v.shots ?? []).filter((s) => allIds.includes(s))));
  const voteRoles = tally(votes.map((v) => (v.roles ?? []).filter((r) => (CRAFT_ROLES as string[]).includes(r))));
  const majority = Math.floor(votes.length / 2) + 1;
  let targets = refs.shots.length ? refs.shots : voteShots.filter(([, n]) => n >= majority).map(([s]) => s);
  if (!targets.length && voteShots.length) targets = [voteShots[0][0]];
  let roles: RoleId[] = voteRoles.filter(([, n]) => n >= majority).map(([r]) => r as RoleId).slice(0, 2);
  if (!roles.length) roles = (voteRoles.length ? [voteRoles[0][0]] : codeRoute.roles) as RoleId[];
  rec.intent = votes.find((v) => v.intent?.trim())?.intent ?? note;
  if (!targets.length) return finish("needs-shot", "Which shot? Give me a shot ID (like 1D) or a timestamp (like 0:12).");

  // ---------------------------------------------------------------- 2. code candidates (needed to decide whether to plan)
  const allowedOf = (ids: string[]) => new Set(ids);
  const check = (purpose: string, ops: PatchOp[], role: RoleId, tier: Cand["tier"], model: string, allowed: Set<string>): Cand | { why: string } => {
    let ev: Evaluation;
    // a token edit that yields an invalid line throws from the guard instead of returning a reason
    try { ev = evaluate(ws, ops, { role, allowed, requireChange: true }); } catch (e) { return { why: (e as Error).message }; }
    if (!ev.ok) return { why: ev.reasons[0] ?? "rejected by the checks" };
    const warn = (xs: typeof ev.newIssues) => xs.filter((i) => i.severity !== "info").length;
    return { purpose, ops, ev, role, tier, model, score: ops.length + 2 * warn(ev.newIssues) - 2 * warn(ev.fixedIssues) + 0.5 * (ev.changedShots.length - 1) };
  };
  const codeCands = async (rs: RoleId[], ids: string[]) => {
    const out: Cand[] = [];
    const targetIssues = ws.qc.issues.filter((i) => i.shot && ids.includes(i.shot));
    for (const role of rs) {
      const ctx: ProposeCtx = { role, note, intent: rec.intent, targets: shotCtx(p, ids), issues: targetIssues, show: p.show, failures: [], seed: 0 };
      const r = await offline.call<RawTakes>({ task: "propose", role, tier: "sonnet", system, prompt: "", context: ctx });
      for (const raw of r.data?.takes ?? []) {
        let ops: PatchOp[];
        try { ops = toOps(raw); } catch { continue; }
        const c = check(raw.purpose, ops, role, "code", "rules", allowedOf(ids));
        if (!("why" in c)) out.push(c);
      }
    }
    return out;
  };
  let pool: Cand[] = await codeCands(roles, targets);

  // ---------------------------------------------------------------- 3. plan (Pro), unless code already answers a plain tweak
  const plain = refs.shots.length === 1 && roles.length === 1 && targets.length === 1 && pool.length > 0 && note.trim().split(/\s+/).length <= GUIDED.plainTweakWords;
  let plan: { brief: string; keep: string; success: string } | null = null;
  if (!plain) {
    const pr = await call<{ shots: string[]; roles: string[]; intent: string; brief: string; keep: string; success: string }>({
      task: "plan", role: "director", tier: "opus", system, schema: planDetailSchema(allIds), context: routeCtx, maxTokens: 4000,
      prompt: `${routePrompt}\n\nA quick read chose shots ${targets.join(", ")} and role${roles.length > 1 ? "s" : ""} ${roles.join(" + ")}.\nYou are the director. Confirm or correct that, then write the plan: the goal in one sentence, a brief for the builder (what to do), what must not change, and how to tell a take worked. Be exact, the builder follows you literally: in "brief", name the line addresses to change (like 1G.3) and the values (seconds, lens, speed, words); never write placeholders like ~N or "adjust the framing".`,
    }, "planning");
    if (pr.ok && pr.data) {
      const ps = (pr.data.shots ?? []).filter((s) => allIds.includes(s));
      const pRoles = (pr.data.roles ?? []).filter((r): r is RoleId => (CRAFT_ROLES as string[]).includes(r)).slice(0, 2);
      if (!refs.shots.length && ps.length) targets = ps;           // the note's own shot ids always win
      if (pRoles.length) roles = pRoles;
      rec.intent = pr.data.intent || rec.intent;
      plan = { brief: pr.data.brief ?? "", keep: pr.data.keep ?? "", success: pr.data.success ?? "" };
      pool = await codeCands(roles, targets);
    }
  }
  rec.targets = targets;
  rec.roles = roles;
  emit({ kind: "step", role: "router", message: `note -> ${roles.join(" + ")} on ${targets.join(", ")}${plan ? " (planned)" : ""}` });

  // ---------------------------------------------------------------- 4. build, repair, debug
  const allowed = allowedOf(targets);
  const targetIssues = ws.qc.issues.filter((i) => i.shot && allowed.has(i.shot));
  const taste = p.taste();
  const failures: Failure[] = [];
  let pushback: string | null = null, idea: string | null = null;

  const buildPrompt = (role: RoleId, extra: string) => {
    const g = { ws, show: p.show, role, targets };
    const ex = grip.patch.examples ? examplesFor(g, grip.patch.examples) : [];
    return [
      `You are the ${ROLES[role].title} on a film crew. ${ROLES[role].brief}`,
      `NOTE FROM THE DIRECTOR: "${note}"`,
      `GOAL: ${rec.intent}`,
      plan ? `THE DIRECTOR'S PLAN\nDo: ${plan.brief}\nKeep unchanged: ${plan.keep}\nSuccess looks like: ${plan.success}` : "",
      `HOW TO WRITE A PATCH\n${patchGuide(g)}`,
      `THE LINES YOU MAY CHANGE\n${targetListing(g)}`,
      grip.patch.context === "episode" ? `THE WHOLE EPISODE, FOR CONTEXT (change only your shots)\n${listing(ws.doc, ws.compiled, allowed)}` : "",
      ex.length ? `EXAMPLES OF VALID PATCHES ON THESE SHOTS (format only; they are not the answer)\n${ex.map((e) => `purpose: ${e.purpose}\npatch:\n${e.patch}`).join("\n\n")}` : "",
      `QC issues in these shots:\n${issuesText(targetIssues)}`,
      taste.accepted.length || taste.rejected.length ? `This director's taste:\n${[...taste.accepted.map((a) => "+ " + a), ...taste.rejected.map((a) => "- " + a)].join("\n")}` : "",
      extra,
      `Write 1 to 3 different takes. Each "patch" is plain patch lines, one change per line, nothing else. Smallest change first.`,
    ].filter(Boolean).join("\n\n");
  };

  /** Turns a model's takes into checked candidates; every failure is recorded with a plain-words fix. */
  const absorb = (role: RoleId, data: { takes?: { purpose?: string; patch?: string }[]; pushback?: string | null; idea?: string | null } | null, tier: Tier, model: string) => {
    const got: Cand[] = [];
    if (!data) return got;
    pushback = pushback ?? data.pushback ?? null;
    idea = idea ?? data.idea ?? null;
    for (const t of (data.takes ?? []).slice(0, 3)) {
      const { text, dropped } = cleanPatch(t.patch ?? "");
      const purpose = (t.purpose ?? "").trim() || "untitled take";
      const fail = (why: string) => {
        const explained = explainFailure(text || String(t.patch ?? ""), why, { ws, show: p.show, role, targets });
        failures.push({ role, patch: text || String(t.patch ?? ""), why: explained });
        rec.rejected.push({ tier, reason: `${(text || String(t.patch ?? "")).replace(/\n/g, "; ")} => ${why}` });
      };
      if (!text) { fail(dropped.length ? `no patch lines found (got: ${dropped.slice(0, 2).join(" / ")})` : "empty patch"); continue; }
      let ops: PatchOp[];
      try { ops = parsePatch(text); } catch (e) { fail((e as Error).message); continue; }
      const c = check(purpose, ops, role, tier, model, allowed);
      if ("why" in c) fail(c.why); else got.push(c);
    }
    return got;
  };

  const build = async (role: RoleId, extra = "") => {
    const r = await call<RawTextTakes>({ task: "build", role, tier: "sonnet", system, prompt: buildPrompt(role, extra), schema: textTakesSchema, maxTokens: 8000 }, `${role}: building takes`);
    return r.ok ? absorb(role, r.data, "sonnet", r.model) : (failures.push({ role, patch: "", why: r.error ?? "no reply" }), []);
  };
  const repairNote = (role: RoleId) => {
    const mine = failures.filter((f) => f.role === role).slice(-4);
    return mine.length ? `YOUR LAST TAKES WERE REJECTED. Fix them:\n${mine.map((f) => `patch:\n${f.patch || "(none)"}\nproblem: ${f.why}`).join("\n\n")}` : "";
  };

  const fromModels: Cand[] = [];
  for (const role of roles) {
    let got = await build(role);
    for (let round = 0; round < grip.patch.repairs && !got.length; round++) {
      emit({ kind: "step", role, message: `${role}: repair round ${round + 1}` });
      got = await build(role, repairNote(role));
    }
    if (!got.length) {
      emit({ kind: "step", role, message: `${role}: the director is debugging it` });
      const r = await call<RawTextTakes>({ task: "repair", role, tier: "opus", system, prompt: buildPrompt(role, `${repairNote(role)}\n\nThe builder could not get this right. You are the director: write takes that pass.`), schema: textTakesSchema, maxTokens: 8000 }, `${role}: director debugging`);
      if (r.ok) got = absorb(role, r.data, "opus", r.model);
    }
    fromModels.push(...got);
  }

  // two roles: also offer the combination of each role's best take
  if (roles.length === 2) {
    const a = fromModels.find((c) => c.role === roles[0]), b = fromModels.find((c) => c.role === roles[1]);
    if (a && b) {
      const both = check(`${a.purpose}; ${b.purpose.charAt(0).toLowerCase()}${b.purpose.slice(1)}`, [...a.ops, ...b.ops], "director", a.tier, a.model, allowed);
      if (!("why" in both)) fromModels.unshift(both);
    }
  }

  // a model with a loose grip owns the answer; code's moves only stand in when it produced nothing
  pool = dedupe(grip.patch.codeFirst || !fromModels.length ? [...fromModels, ...pool] : fromModels);
  const fixesError = (c: Cand) => c.ev.fixedIssues.some((i) => i.severity === "error");
  if (targetIssues.some((i) => i.severity === "error") && pool.some(fixesError)) pool = pool.filter(fixesError);
  rec.pushback = pushback;
  rec.idea = idea;
  if (!pool.length) {
    const top = failures.slice(-3).map((f) => f.why).join(" ");
    return finish("failed", `No take passed the checks (${rec.rejected.length} rejected). ${top}`.trim());
  }

  // ---------------------------------------------------------------- 5. rank (Lite votes, Borda count)
  pool = await rank(pool);

  // ---------------------------------------------------------------- 6. review (Pro), with one redo round if nothing fits the plan
  for (let pass = 0; pass < 2; pass++) {
    const shown = pool.slice(0, GUIDED.maxTakes);
    const r = await call<{ order: number[]; fits: boolean[]; message: string; pushback: string | null; idea: string | null; redo: string | null }>({
      task: "review", role: "director", tier: "opus", system, schema: reviewSchema, maxTokens: 4000,
      prompt: reviewPrompt({ note, intent: rec.intent, plan, shots: listing(ws.doc, ws.compiled, allowed), takes: shown.map((c) => ({ purpose: c.purpose, patch: printPatch(c.ops), changed: c.ev.changedShots, fixed: c.ev.fixedIssues.length, added: c.ev.newIssues.length })) }),
    }, "director reviewing");
    if (!r.ok || !r.data) break;
    const order = cleanOrder(r.data.order, shown.length);
    // fits[i] belongs to take i+1 as shown, not to the ranking; if Pro sent fits at all, a missing entry means it did not vouch for that take
    const fl = Array.isArray(r.data.fits) ? r.data.fits : [];
    const fits = order.map((i) => (fl.length ? fl[i] === true : true));
    pool = [...order.map((i) => shown[i]), ...pool.slice(shown.length)];
    rec.message = (r.data.message ?? "").trim();
    rec.pushback = r.data.pushback ?? rec.pushback;
    rec.idea = r.data.idea ?? rec.idea;
    if (fits.some(Boolean) || pass === 1 || !r.data.redo) break;
    emit({ kind: "step", role: "director", message: "no take fits the plan; one more round" });
    const more: Cand[] = [];
    for (const role of roles) more.push(...(await build(role, `THE DIRECTOR REVIEWED THE LAST TAKES AND NONE FIT. Change this: ${r.data.redo}`)));
    if (!more.length) break;
    pool = dedupe([...more, ...pool]);
  }

  const letters = "ABC";
  rec.takes = pool.slice(0, GUIDED.maxTakes).map((c, i): TakeRecord => ({
    id: `${rec.id}-${letters[i]}`, purpose: c.purpose, patch: printPatch(c.ops), roles: [c.role], tier: c.tier, model: c.model,
    changedShots: c.ev.changedShots, fixed: c.ev.fixedIssues.map((x) => x.message), added: c.ev.newIssues.map((x) => `${x.severity}: ${x.message}`), score: Math.round(c.score * 10) / 10,
  }));
  if (!rec.message) rec.message = `${rec.takes.length} take${rec.takes.length > 1 ? "s" : ""}. Recommended: ${rec.takes[0].purpose}.`;
  return finish("open", rec.message);

  // ---------------------------------------------------------------- helpers that need the closure
  async function rank(cs: Cand[]): Promise<Cand[]> {
    if (cs.length < 2) return cs;
    const list = cs.slice(0, 8);
    const prompt = `NOTE: "${note}"\nGOAL: ${rec.intent}\n\nCANDIDATES (all valid):\n${list.map((c, i) => `${i + 1}. ${c.purpose}\n   ${printPatch(c.ops).replace(/\n/g, "\n   ")}`).join("\n")}\n\nWhich candidates best do what the note asks? Give all the numbers, best first.`;
    const rs = await Promise.all(Array.from({ length: grip.rank.votes }, () => call<{ order: number[]; why: string }>({ task: "rank", role: "ranker", tier: "haiku", system, prompt, schema: rankSchema, maxTokens: 800 }, "ranking takes")));
    const pts = new Array(list.length).fill(0);
    let counted = 0;
    for (const r of rs) {
      if (!r.ok || !r.data) continue;
      counted++;
      cleanOrder(r.data.order, list.length).forEach((idx, k) => { pts[idx] += list.length - k; });
    }
    if (!counted) return [...cs].sort((a, b) => a.score - b.score);
    const idx = list.map((_, i) => i).sort((a, b) => pts[b] - pts[a] || list[a].score - list[b].score);
    return [...idx.map((i) => list[i]), ...cs.slice(list.length)];
  }
}

type RawTextTakes = { takes?: { purpose?: string; patch?: string }[]; pushback?: string | null; idea?: string | null };

/** What Pro sees when it reviews takes. Exported so the review eval sends exactly the same thing. */
export function reviewPrompt(o: { note: string; intent: string; plan: { brief: string; keep: string; success: string } | null; shots: string; takes: { purpose: string; patch: string; changed: string[]; fixed: number; added: number }[] }): string {
  return `NOTE: "${o.note}"\nGOAL: ${o.intent}${o.plan ? `\nPLAN: ${o.plan.brief}\nKEEP: ${o.plan.keep}\nSUCCESS: ${o.plan.success}` : ""}\n\nTAKES (all passed the grammar, permission, locality and QC checks; that says nothing about whether they do what was asked):\n${o.takes.map((t, i) => `${i + 1}. ${t.purpose}\n${t.patch}\nchanges ${t.changed.join(", ")}; fixes ${t.fixed} QC issue(s); adds ${t.added}`).join("\n\n")}\n\nTHE SHOTS (before any take):\n${o.shots}\n\nJudge each take by its patch, not by its purpose line: purposes can be wrong. Order the takes best first by number, say for each take in its original numbering (take 1 first, not your ranking) whether it does what the note and plan asked without breaking what the plan says to keep, write the message to the director (results first, short), keep or sharpen any pushback, and give one idea. If no take fits, say in "redo" exactly what the builder should change.`;
}

/** Models number from 1, sometimes from 0, repeat numbers and skip some: return a full 0-based permutation. */
export function cleanOrder(order: unknown, n: number): number[] {
  const raw = Array.isArray(order) ? order.map(Number).filter((x) => Number.isInteger(x)) : [];
  const oneBased = raw.length > 0 && !raw.includes(0); // we always show numbers from 1; a 0 means the model counted from 0
  const out: number[] = [];
  for (const x of raw) { const i = oneBased ? x - 1 : x; if (i >= 0 && i < n && !out.includes(i)) out.push(i); }
  for (let i = 0; i < n; i++) if (!out.includes(i)) out.push(i);
  return out;
}

function dedupe(cs: Cand[]): Cand[] {
  const seen = new Set<string>();
  return cs.filter((c) => {
    const key = c.ev.after!.compiled.shots.filter((s) => c.ev.changedShots.includes(s.id)).map((s) => s.hash).join("|") + c.ev.changedShots.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
