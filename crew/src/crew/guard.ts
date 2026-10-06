// The locality guard. Every patch, from Claude or a human, goes through here:
// permissions -> apply -> validate -> compile -> compare per-shot content hashes.
// A patch that changes a shot nobody asked about is rejected with the reason.

import type { Doc, Show } from "../scene/ast.ts";
import type { VoiceLookup } from "../voice/bank.ts";
import { compile, type Compiled, type CompiledShot } from "../scene/compile.ts";
import { validate, type Issue } from "../scene/parse.ts";
import { applyPatch, checkPermission, PatchError, printPatch, type Change, type PatchOp } from "../scene/patch.ts";
import type { RoleId } from "../scene/registry.ts";
import { issueKey, runQc, type QcIssue, type QcReport } from "../qc/checks.ts";

export interface Workspace {
  show: Show;
  doc: Doc;
  grammar: Issue[];
  compiled: Compiled;
  qc: QcReport;
  voices?: VoiceLookup;
}

export function workspace(show: Show, doc: Doc, voices?: VoiceLookup): Workspace {
  const grammar = validate(doc, show);
  const compiled = compile(show, doc, { voices });
  return { show, doc, grammar, compiled, qc: runQc(compiled, grammar), voices };
}

export interface GuardOptions {
  role: RoleId;
  /** shots this change is allowed to affect; null = whatever the ops touch */
  allowed: Set<string> | null;
  /** reject patches that change nothing on screen */
  requireChange?: boolean;
  /** let a patch introduce new QC errors (manual override) */
  allowNewErrors?: boolean;
  /** let a patch spill into other shots (director override) */
  allowSpill?: boolean;
}

export interface Evaluation {
  ok: boolean;
  reasons: string[];
  patch: string;
  ops: PatchOp[];
  changes: Change[];
  changedShots: string[];
  spill: { shot: string; why: string }[];
  newIssues: QcIssue[];
  fixedIssues: QcIssue[];
  after: Workspace | null;
}

export function evaluate(ws: Workspace, ops: PatchOp[], o: GuardOptions): Evaluation {
  const ev: Evaluation = { ok: false, reasons: [], patch: printPatch(ops), ops, changes: [], changedShots: [], spill: [], newIssues: [], fixedIssues: [], after: null };
  if (!ops.length) { ev.reasons.push("empty patch"); return ev; }
  const perm = checkPermission(o.role, ops, ws.doc);
  if (perm.length) { ev.reasons.push(...perm.map((p) => `permission: ${p}`)); return ev; }
  let doc: Doc;
  let touched: Set<string>;
  try {
    const r = applyPatch(ws.doc, ops);
    doc = r.doc; touched = r.touched; ev.changes = r.changes;
  } catch (e) {
    if (e instanceof PatchError) { ev.reasons.push(`patch: ${e.message}`); return ev; }
    throw e;
  }
  const after = workspace(ws.show, doc, ws.voices);
  ev.after = after;

  const beforeGrammar = new Set(ws.grammar.map((g) => g.message));
  const newGrammar = after.grammar.filter((g) => !beforeGrammar.has(g.message));
  if (newGrammar.length) ev.reasons.push(...newGrammar.map((g) => `grammar: ${g.addr} ${g.message}`));

  const before = new Map(ws.compiled.shots.map((s) => [s.id, s]));
  const now = new Map(after.compiled.shots.map((s) => [s.id, s]));
  const changed = new Set<string>();
  for (const [id, s] of now) if (before.get(id)?.hash !== s.hash) changed.add(id);
  for (const id of before.keys()) if (!now.has(id)) changed.add(id);
  ev.changedShots = [...changed];

  const allowed = o.allowed ? new Set([...o.allowed]) : new Set(touched);
  // a shot the patch itself creates or deletes is always "asked for"
  for (const id of touched) if (!before.has(id) || !now.has(id)) allowed.add(id);
  for (const id of changed) {
    if (allowed.has(id)) continue;
    ev.spill.push({ shot: id, why: explainSpill(ws.compiled, after.compiled, before.get(id), now.get(id)) });
  }
  for (const id of touched) if (o.allowed && !o.allowed.has(id) && before.has(id) && now.has(id) && !ev.spill.some((s) => s.shot === id)) {
    ev.spill.push({ shot: id, why: "the patch edits lines in this shot, which the note didn't ask about" });
  }
  if (ev.spill.length && !o.allowSpill) ev.reasons.push(...ev.spill.map((s) => `locality: ${s.shot} would change too (${s.why})`));
  if (o.requireChange && changed.size === 0) ev.reasons.push("no visible change: every shot renders identically");

  const beforeKeys = new Set(ws.qc.issues.map(issueKey));
  const afterKeys = new Set(after.qc.issues.map(issueKey));
  ev.newIssues = after.qc.issues.filter((i) => !beforeKeys.has(issueKey(i)));
  ev.fixedIssues = ws.qc.issues.filter((i) => !afterKeys.has(issueKey(i)));
  const newErrors = ev.newIssues.filter((i) => i.severity === "error" && i.check !== "grammar");
  if (newErrors.length && !o.allowNewErrors) ev.reasons.push(...newErrors.map((i) => `qc: ${i.shot ?? ""} ${i.message}`));

  ev.ok = ev.reasons.length === 0;
  return ev;
}

function explainSpill(b: Compiled, a: Compiled, sb?: CompiledShot, sa?: CompiledShot): string {
  if (!sb || !sa) return "shot added or removed";
  const parts: string[] = [];
  const ids = new Set([...b.presentIn(sb), ...a.presentIn(sa)]);
  for (const id of ids) {
    const x = b.charAt(sb, 0, id), y = a.charAt(sa, 0, id);
    if (x.present !== y.present) parts.push(`${id} ${y.present ? "is now" : "is no longer"} on set at the start`);
    else if (Math.hypot(x.x - y.x, x.z - y.z) > 0.05) parts.push(`${id} starts ${Math.hypot(x.x - y.x, x.z - y.z).toFixed(2)}m from where they did; pin them with ${id}@<anchor> or accept the continuity change`);
    else if (x.expr !== y.expr) parts.push(`${id} starts with a different expression`);
  }
  if (!parts.length) {
    const cb = b.camAt(sb, 0), ca = a.camAt(sa, 0);
    if (Math.hypot(cb.pos[0] - ca.pos[0], cb.pos[1] - ca.pos[1], cb.pos[2] - ca.pos[2]) > 0.02) parts.push("its camera setup moves");
    else if (Math.abs(sb.dur - sa.dur) > 0.01) parts.push(`its length changes ${sb.dur.toFixed(2)}s -> ${sa.dur.toFixed(2)}s`);
    else parts.push("its rendered content changes");
  }
  return parts.join("; ");
}
