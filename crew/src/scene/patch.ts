// Line-addressed patches. A note becomes a handful of these, never a rewrite.
//
//   4G.3 ~2 -> ~3                 token edit inside one line (cheapest form)
//   4G.3 = kiran shock ~3         replace a line
//   4G.3 + with mum sigh          insert after a line (after the header = first body line)
//   4G.3 -                        delete a line (deleting a header drops the whole shot)
//   4G ++ 4GA CU mum              insert a new shot after shot 4G
//
// Addresses always refer to the document *before* the patch, so ops in one
// patch never shift each other's targets.

import type { Doc, DocLine, Node, ShotHeader } from "./ast.ts";
import { parseLine, printNode, SceneError, structure, tokenize, SHOT_ID } from "./parse.ts";
import { ACTION_VERBS, type RoleId } from "./registry.ts";

export type PatchOp =
  | { op: "edit"; addr: string; from: string; to: string }
  | { op: "replace"; addr: string; node: Node }
  | { op: "insert"; addr: string; node: Node }
  | { op: "delete"; addr: string }
  | { op: "insert_shot"; addr: string; node: ShotHeader };

export interface Change {
  addr: string;
  shot: string | null;
  before: string | null;
  after: string | null;
}

export interface PatchResult {
  doc: Doc;
  changes: Change[];
  /** shots whose source changed (including inserted / deleted shots) */
  touched: Set<string>;
}

export class PatchError extends Error {}

// ---------------------------------------------------------------- text form

export function parsePatch(text: string): PatchOp[] {
  const ops: PatchOp[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let m: RegExpMatchArray | null;
    try {
      if ((m = line.match(/^(\S+)\s+-$/))) ops.push({ op: "delete", addr: m[1] });
      else if ((m = line.match(/^(\S+)\s+\+\+\s+(.+)$/))) {
        const node = parseLine(m[2], false);
        if (!node || node.kind !== "shot") throw new PatchError(`"++" needs a shot header: ${m[2]}`);
        ops.push({ op: "insert_shot", addr: m[1], node });
      } else if ((m = line.match(/^(\S+)\s+\+\s+(.+)$/))) {
        const node = parseLine(m[2], true);
        if (!node) throw new PatchError(`empty insert at ${m[1]}`);
        ops.push({ op: "insert", addr: m[1], node });
      } else if ((m = line.match(/^(\S+)\s+=\s+(.+)$/))) {
        const header = SHOT_ID.test(m[1]) || m[1].startsWith("scene") || m[1] === "episode";
        const node = parseLine(m[2], !header);
        if (!node) throw new PatchError(`empty replace at ${m[1]}`);
        ops.push({ op: "replace", addr: m[1], node });
      } else if ((m = line.match(/^(\S+)\s+(.+?)\s+->\s+(.*)$/))) ops.push({ op: "edit", addr: m[1], from: m[2], to: m[3] });
      else throw new PatchError(`can't read patch line: ${line}`);
    } catch (e) {
      if (e instanceof SceneError) throw new PatchError(`${line}: ${e.message}`);
      throw e;
    }
  }
  return ops;
}

export function printOp(op: PatchOp): string {
  switch (op.op) {
    case "edit": return `${op.addr} ${op.from} -> ${op.to}`;
    case "replace": return `${op.addr} = ${printNode(op.node).trim()}`;
    case "insert": return `${op.addr} + ${printNode(op.node).trim()}`;
    case "delete": return `${op.addr} -`;
    case "insert_shot": return `${op.addr} ++ ${printNode(op.node)}`;
  }
}

export const printPatch = (ops: PatchOp[]) => ops.map(printOp).join("\n");

// ---------------------------------------------------------------- ownership

/** Which crew role owns a line. Locality starts here: roles can only write their own lines. */
export function ownerOf(n: Node): RoleId | "any" {
  switch (n.kind) {
    case "shot": case "light": return "dp";
    case "action": return ACTION_VERBS[n.verb]?.role ?? "blocking";
    case "dialogue": return "writer";
    case "sound": return "sound";
    case "edit": return "editor";
    case "comment": return "any";
    case "scene": case "episode": return "director";
  }
}

export function checkPermission(role: RoleId, ops: PatchOp[], doc: Doc): string[] {
  if (role === "director") return [];
  const st = structure(doc);
  const problems: string[] = [];
  const nodeAt = (addr: string) => { const i = st.addr.get(addr); return i === undefined ? null : doc.lines[i].node; };
  const mine = (n: Node | null) => !n || ownerOf(n) === role || ownerOf(n) === "any";
  for (const op of ops) {
    const old = op.op === "insert" || op.op === "insert_shot" ? null : nodeAt(op.addr);
    if (op.op === "delete" && old?.kind === "shot") {
      if (role !== "editor") problems.push(`${role} cannot drop shot ${op.addr} (editor's call)`);
      continue;
    }
    if (op.op === "insert_shot") {
      if (role !== "dp") problems.push(`${role} cannot add shots (DP's call)`);
      continue;
    }
    if (!mine(old)) problems.push(`${role} cannot change ${op.addr} (owned by ${ownerOf(old!)})`);
    if ((op.op === "replace" || op.op === "insert") && !mine(op.node)) {
      problems.push(`${role} cannot write a ${op.node.kind} line (owned by ${ownerOf(op.node)})`);
    }
    if (op.op === "edit" && old) {
      // re-parse the edited line to see what it becomes
      try {
        const after = parseLine(applyTokenEdit(printNode(old), op.from, op.to), old.kind !== "shot" && old.kind !== "scene" && old.kind !== "episode");
        if (after && !mine(after)) problems.push(`${role} cannot turn ${op.addr} into a ${ownerOf(after)} line`);
      } catch { /* reported by apply */ }
    }
  }
  return problems;
}

// ---------------------------------------------------------------- application

function applyTokenEdit(text: string, from: string, to: string): string {
  const toks = tokenize(text);
  const f = tokenize(from);
  const t = tokenize(to);
  const hits: number[] = [];
  for (let i = 0; i + f.length <= toks.length; i++) if (f.every((x, k) => toks[i + k] === x)) hits.push(i);
  if (hits.length === 0) throw new PatchError(`"${from}" not found in: ${text.trim()}`);
  if (hits.length > 1) throw new PatchError(`"${from}" is ambiguous in: ${text.trim()}`);
  toks.splice(hits[0], f.length, ...t);
  const indent = /^\s/.test(text) ? "  " : "";
  return indent + toks.join(" ");
}

export function applyPatch(doc: Doc, ops: PatchOp[]): PatchResult {
  const st = structure(doc);
  const lines: DocLine[] = doc.lines.map((l) => ({ ...l }));
  let nextUid = Math.max(0, ...lines.map((l) => l.uid)) + 1;
  const byUid = () => new Map(lines.map((l, i) => [l.uid, i]));
  const changes: Change[] = [];
  const touched = new Set<string>();
  const lastInsertAfter = new Map<number, number>(); // anchor uid -> uid of last line inserted after it

  const created = new Map<string, number>(); // shot ids added by this patch -> header uid
  const resolve = (addr: string) => {
    const c = created.get(addr);
    if (c !== undefined) return { uid: c, shot: addr };
    const i = st.addr.get(addr);
    if (i === undefined) throw new PatchError(`no line at address ${addr}`);
    return { uid: doc.lines[i].uid, shot: st.shotOf.get(i) ?? null };
  };
  const setNode = (line: DocLine, node: Node) => {
    line.node = node;
    line.text = printNode(node);
    delete line.error;
  };

  for (const op of ops) {
    const { uid, shot } = resolve(op.addr);
    const idx = byUid().get(uid);
    if (idx === undefined) throw new PatchError(`${op.addr} was already deleted in this patch`);
    const line = lines[idx];
    const before = line.text.trim();
    switch (op.op) {
      case "edit": {
        const text = applyTokenEdit(line.text, op.from, op.to);
        const node = parseLine(text, /^\s/.test(text));
        if (!node) throw new PatchError(`${op.addr} became empty`);
        if (node.kind === "shot" && line.node?.kind === "shot" && node.id !== line.node.id) throw new PatchError("shot ids cannot be renamed by an edit");
        setNode(line, node);
        changes.push({ addr: op.addr, shot, before, after: line.text.trim() });
        if (shot) touched.add(shot);
        break;
      }
      case "replace": {
        if (line.node && (line.node.kind === "shot") !== (op.node.kind === "shot")) throw new PatchError(`${op.addr}: a header can only be replaced by a header`);
        if (op.node.kind === "shot" && line.node?.kind === "shot" && op.node.id !== line.node.id) throw new PatchError("shot ids cannot be renamed");
        setNode(line, op.node);
        changes.push({ addr: op.addr, shot, before, after: line.text.trim() });
        if (shot) touched.add(shot);
        break;
      }
      case "insert": {
        if (["shot", "scene", "episode"].includes(op.node.kind)) throw new PatchError("use ++ to insert shots");
        if (!shot) throw new PatchError(`${op.addr} is not inside a shot`);
        const after = lastInsertAfter.get(uid) ?? uid;
        const at = byUid().get(after)! + 1;
        const nl: DocLine = { uid: nextUid++, text: "", node: null };
        setNode(nl, op.node);
        lines.splice(at, 0, nl);
        lastInsertAfter.set(uid, nl.uid);
        changes.push({ addr: `${op.addr}+`, shot, before: null, after: nl.text.trim() });
        touched.add(shot);
        break;
      }
      case "delete": {
        if (line.node?.kind === "shot") {
          let end = idx + 1;
          while (end < lines.length && (!lines[end].node || !["shot", "scene"].includes(lines[end].node!.kind))) end++;
          const removed = lines.splice(idx, end - idx);
          changes.push({ addr: op.addr, shot, before: removed.map((l) => l.text.trim()).filter(Boolean).join(" / "), after: null });
        } else {
          if (line.node?.kind === "scene" || line.node?.kind === "episode") throw new PatchError("scene and episode lines cannot be deleted by a patch");
          lines.splice(idx, 1);
          changes.push({ addr: op.addr, shot, before, after: null });
        }
        if (shot) touched.add(shot);
        break;
      }
      case "insert_shot": {
        if (line.node?.kind !== "shot") throw new PatchError(`${op.addr} is not a shot header`);
        if (st.addr.has(op.node.id) || created.has(op.node.id) || lines.some((l) => l.node?.kind === "shot" && l.node.id === op.node.id)) throw new PatchError(`shot id ${op.node.id} already exists`);
        let end = idx + 1;
        while (end < lines.length && (!lines[end].node || !["shot", "scene"].includes(lines[end].node!.kind))) end++;
        while (end > idx + 1 && !lines[end - 1].text.trim()) end--;
        const nl: DocLine = { uid: nextUid++, text: "", node: null };
        setNode(nl, op.node);
        lines.splice(end, 0, nl);
        created.set(op.node.id, nl.uid);
        changes.push({ addr: op.node.id, shot: op.node.id, before: null, after: nl.text });
        touched.add(op.node.id);
        break;
      }
    }
  }
  return { doc: { lines }, changes, touched };
}
