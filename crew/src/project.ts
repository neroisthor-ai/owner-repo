// A show on disk: show.scene (bible), epNN.scene (episodes), .crew/ (history,
// snapshots for undo, note records, taste memory). Plain files, open formats.
// All text I/O goes through a ProjectStore (src/storage/); the voice bank still
// writes its wavs and voices.json straight to disk under <dir>/voices.

import { join, resolve } from "node:path";
import { FsStore } from "./storage/fs-store.ts";
import type { ProjectStore } from "./storage/types.ts";
import { parseEpisode, parseShow, printDoc } from "./scene/parse.ts";
import type { Show } from "./scene/ast.ts";
import { evaluate, workspace, type Evaluation, type GuardOptions, type Workspace } from "./crew/guard.ts";
import { parsePatch, type PatchOp } from "./scene/patch.ts";
import type { RoleId } from "./scene/registry.ts";
import type { Taste } from "./crew/prompts.ts";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { VoiceBank } from "./voice/bank.ts";
import type { TtsEngine } from "./voice/engines.ts";

export const CREW_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LIBRARY_DIR = join(CREW_ROOT, "library");

export interface HistoryEntry {
  id: string;
  at: string;
  role: RoleId;
  source: "human" | "crew" | "mcp" | "editor";
  patch: string;
  changedShots: string[];
  noteId?: string;
  takeId?: string;
  summary: string;
}

export interface TakeRecord {
  id: string;
  purpose: string;
  patch: string;
  roles: RoleId[];
  tier: string;
  model: string;
  changedShots: string[];
  fixed: string[];
  added: string[];
  score: number;
}

export interface NoteRecord {
  id: string;
  at: string;
  note: string;
  targets: string[];
  roles: RoleId[];
  intent: string;
  takes: TakeRecord[];
  message: string;
  pushback: string | null;
  idea: string | null;
  rejected: { tier: string; reason: string }[];
  status: "open" | "accepted" | "rejected" | "needs-shot" | "failed";
  round: number;
  parent?: string;
  accepted?: string;
  rating?: "better" | "worse";
  cost: number;
  tokens: number;
  ms: number;
  mode: "claude" | "gemini" | "offline";
}

export class Project {
  readonly dir: string;
  readonly episodeFile: string;
  showSrc = "";
  show!: Show;
  ws!: Workspace;
  history: HistoryEntry[] = [];
  notes: NoteRecord[] = [];
  private seq = 0;
  voices!: VoiceBank;

  readonly store: ProjectStore;

  constructor(dir: string, episode?: string, store?: ProjectStore) {
    this.dir = resolve(dir);
    this.store = store ?? new FsStore(this.dir);
    if (!this.store.exists("show.scene")) throw new Error(`no show.scene in ${this.dir}`);
    this.episodeFile = episode ?? this.episodes[0] ?? "ep01.scene";
    this.store.mkdirp(".crew/snapshots");
    this.history = readJsonl<HistoryEntry>(this.store, ".crew/history.jsonl");
    this.notes = collapseNotes(readJsonl<NoteRecord>(this.store, ".crew/notes.jsonl"));
    this.seq = this.history.length + this.notes.length;
    this.voices = new VoiceBank(this.dir, "/show-media/voices", LIBRARY_DIR);
    this.reload();
  }

  get crewDir() { return join(this.dir, ".crew"); }
  get episodePath() { return join(this.dir, this.episodeFile); }
  get episodes() { return this.store.list(".").filter((f) => /^ep.*\.scene$/.test(f)).sort(); }

  /** Replace the show bible. Only for changes the director approved (people own the bible). */
  setShowSource(text: string) {
    this.store.writeText("show.scene", text);
    this.reload();
  }

  reload() {
    this.showSrc = this.store.readText("show.scene") ?? "";
    this.show = parseShow(this.showSrc);
    const ep = this.store.readText(this.episodeFile) ?? 'episode 1 ""\n';
    this.ws = workspace(this.show, parseEpisode(ep), this.voices.lookup(this.show));
  }

  get episodeSrc() { return printDoc(this.ws.doc); }

  id(prefix: string) {
    this.seq++;
    return `${prefix}${Date.now().toString(36).slice(-4)}${this.seq.toString(36)}`;
  }

  /** Evaluate a patch (text or ops) against the current episode without applying it. */
  check(patch: string | PatchOp[], o: GuardOptions): Evaluation {
    const ops = typeof patch === "string" ? parsePatch(patch) : patch;
    return evaluate(this.ws, ops, o);
  }

  /** Commit an evaluation that passed the guard. */
  commit(ev: Evaluation, meta: Omit<HistoryEntry, "id" | "at" | "patch" | "changedShots" | "summary"> & { summary?: string }): HistoryEntry {
    if (!ev.ok || !ev.after) throw new Error(`refusing to commit a failing patch: ${ev.reasons.join("; ")}`);
    return this.write(ev.after, { ...meta, patch: ev.patch, changedShots: ev.changedShots, summary: meta.summary ?? ev.changes.map((c) => `${c.addr}: ${c.before ?? "∅"} -> ${c.after ?? "∅"}`).join("; ") });
  }

  /** Replace the whole episode (code editor, writers' room). Grammar errors are allowed but reported. */
  replaceEpisode(text: string, meta: { role: RoleId; source: HistoryEntry["source"]; summary: string }): HistoryEntry {
    const next = workspace(this.show, parseEpisode(text), this.ws.voices);
    const before = new Map(this.ws.compiled.shots.map((s) => [s.id, s.hash]));
    const changed = next.compiled.shots.filter((s) => before.get(s.id) !== s.hash).map((s) => s.id);
    for (const id of before.keys()) if (!next.compiled.shots.some((s) => s.id === id)) changed.push(id);
    return this.write(next, { ...meta, patch: "(full rewrite)", changedShots: changed });
  }

  private write(next: Workspace, e: Omit<HistoryEntry, "id" | "at">): HistoryEntry {
    const entry: HistoryEntry = { id: this.id("h"), at: new Date().toISOString(), ...e };
    this.store.writeText(`.crew/snapshots/${entry.id}.scene`, this.episodeSrc);
    this.store.writeText(this.episodeFile, printDoc(next.doc));
    this.store.appendText(".crew/history.jsonl", JSON.stringify(entry) + "\n");
    this.history.push(entry);
    this.ws = next;
    return entry;
  }

  /** Every dialogue line in the episode, in cut order. */
  dialogueLines() {
    return this.ws.doc.lines.flatMap((l) => (l.node?.kind === "dialogue" ? [{ actor: l.node.actor, verb: l.node.verb, text: l.node.text }] : []));
  }

  /** Render temp voices for every line (cached by content), then retime the cut to the real durations. */
  async renderVoices(engine: TtsEngine, o: { force?: boolean; prune?: boolean; onProgress?: (done: number, total: number, line: string, cached: boolean) => void } = {}) {
    const r = await this.voices.render(this.show, this.dialogueLines(), engine, o);
    if (o.prune) {
      const look = this.voices.lookup(this.show);
      const keep = new Set(this.dialogueLines().map((l) => look(l.actor, l.verb, l.text)?.key).filter((k): k is string => !!k));
      this.voices.prune(keep);
    }
    const before = this.ws.compiled.duration;
    this.reload();
    return { ...r, durationBefore: before, durationAfter: this.ws.compiled.duration };
  }

  undo(): HistoryEntry | null {
    const last = this.history.pop();
    if (!last) return null;
    const snap = `.crew/snapshots/${last.id}.scene`;
    const text = this.store.readText(snap);
    if (text === null) throw new Error(`snapshot ${last.id}.scene is missing`);
    this.store.writeText(this.episodeFile, text);
    this.store.writeText(".crew/history.jsonl", this.history.map((h) => JSON.stringify(h) + "\n").join(""));
    this.reload();
    return last;
  }

  saveNote(n: NoteRecord) {
    const i = this.notes.findIndex((x) => x.id === n.id);
    if (i >= 0) this.notes[i] = n; else this.notes.push(n);
    this.store.appendText(".crew/notes.jsonl", JSON.stringify(n) + "\n");
  }

  /** What the director has accepted and rejected recently, fed back into prompts. */
  taste(limit = 8): Taste {
    const accepted: string[] = [], rejected: string[] = [];
    for (const n of [...this.notes].reverse()) {
      if (n.status === "accepted" && n.accepted) {
        const t = n.takes.find((x) => x.id === n.accepted);
        if (t && accepted.length < limit) accepted.push(`"${n.note}" -> ${t.purpose}${n.rating === "worse" ? " (later rated worse)" : ""}`);
        for (const o of n.takes) if (o.id !== n.accepted && rejected.length < limit) rejected.push(`"${n.note}" -> ${o.purpose}`);
      } else if (n.status === "rejected") {
        for (const o of n.takes) if (rejected.length < limit) rejected.push(`"${n.note}" -> ${o.purpose}`);
      }
    }
    return { accepted, rejected };
  }

  /** North star: share of notes fixed in one round, with no side effects, not later rated worse. */
  metrics() {
    const closed = this.notes.filter((n) => n.status === "accepted" || n.status === "rejected");
    const firstRound = closed.filter((n) => n.status === "accepted" && n.round === 1 && n.rating !== "worse");
    const cost = this.notes.reduce((a, n) => a + n.cost, 0);
    return {
      notes: this.notes.length,
      closed: closed.length,
      resolvedFirstRound: firstRound.length,
      resolutionRate: closed.length ? firstRound.length / closed.length : null,
      cost,
      costPerNote: this.notes.length ? cost / this.notes.length : 0,
    };
  }
}

function readJsonl<T>(store: ProjectStore, path: string): T[] {
  return (store.readText(path) ?? "").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as T]; } catch { return []; } });
}

/** notes.jsonl is append-only; the last record per id wins. */
function collapseNotes(rows: NoteRecord[]): NoteRecord[] {
  const m = new Map<string, NoteRecord>();
  for (const r of rows) m.set(r.id, r);
  return [...m.values()];
}
