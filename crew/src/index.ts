// Crew as a library. Everything the web app, the CLI and the MCP server do goes
// through this class, so any program (or any Claude) can drive the crew:
//
//   import { Crew } from "crew";
//   const crew = Crew.open("shows/kitchen");          // Claude if credentials exist, offline otherwise
//   const note = await crew.note("1D is too long");    // 2-3 takes, each local and checked
//   crew.accept(note.id, note.takes[0].id);            // applied, logged, undoable
//   crew.patch("1D.2 ~2.5 -> ~1.5", { role: "animator" });

import { EventEmitter } from "node:events";
import { ClaudeLLM, hasCredentials, type LLM } from "./claude/llm.ts";
import { OfflineLLM } from "./claude/offline.ts";
import { acceptTake, directNote, rejectNote, type CrewEvent, type CrewOptions } from "./crew/direct.ts";
import type { Evaluation } from "./crew/guard.ts";
import { listing } from "./crew/prompts.ts";
import { screen } from "./crew/screening.ts";
import { writeEpisode } from "./crew/writers.ts";
import { toOtio } from "./export/otio.ts";
import { Project } from "./project.ts";
import { bake } from "./scene/compile.ts";
import { parsePatch, PatchError } from "./scene/patch.ts";
import { pickEngine } from "./voice/engines.ts";
import type { RoleId } from "./scene/registry.ts";

export type LLMChoice = LLM | "claude" | "offline" | "auto";

export function pickLLM(choice: LLMChoice = (process.env.CREW_LLM as LLMChoice) ?? "auto"): LLM {
  if (typeof choice === "object") return choice;
  if (choice === "claude") return new ClaudeLLM();
  if (choice === "offline") return new OfflineLLM();
  return hasCredentials() ? new ClaudeLLM() : new OfflineLLM();
}

export interface PatchOptions {
  role?: RoleId;
  dryRun?: boolean;
  /** allow the patch to change shots it doesn't touch (continuity spill) */
  allowSpill?: boolean;
  allowNewErrors?: boolean;
  source?: "human" | "mcp" | "editor";
}

export class Crew {
  readonly project: Project;
  llm: LLM;
  pipeline: "full" | "fast";
  readonly events = new EventEmitter();

  constructor(project: Project, llm: LLM, pipeline: "full" | "fast" = (process.env.CREW_PIPELINE as "fast") ?? "full") {
    this.project = project;
    this.llm = llm;
    this.pipeline = pipeline;
  }

  static open(dir: string, o: { llm?: LLMChoice; episode?: string; pipeline?: "full" | "fast" } = {}) {
    return new Crew(new Project(dir, o.episode), pickLLM(o.llm), o.pipeline);
  }

  private emit = (e: CrewEvent) => this.events.emit("crew", e);

  /** Give the crew a note ("1D 0:03, too long"). Returns 2-3 checked takes; nothing is applied yet. */
  note(text: string, o: Partial<CrewOptions> = {}) {
    return directNote(this.project, text, { llm: this.llm, pipeline: this.pipeline, emit: this.emit, ...o });
  }

  accept(noteId: string, takeId: string) {
    const r = acceptTake(this.project, noteId, takeId);
    this.events.emit("changed", r.history);
    return r;
  }

  reject(noteId: string) { return rejectNote(this.project, noteId); }

  rate(noteId: string, rating: "better" | "worse") {
    const n = this.project.notes.find((x) => x.id === noteId);
    if (!n) throw new Error(`no note ${noteId}`);
    n.rating = rating;
    this.project.saveNote(n);
    return n;
  }

  /** Apply a SCENE patch through the same permissions + locality guard + QC the crew uses. */
  patch(text: string, o: PatchOptions = {}): Evaluation & { committed: boolean } {
    const role = o.role ?? "director";
    let ev: Evaluation;
    try {
      ev = this.project.check(parsePatch(text), { role, allowed: null, allowSpill: o.allowSpill, allowNewErrors: o.allowNewErrors });
    } catch (e) {
      if (e instanceof PatchError) return { ok: false, reasons: [e.message], patch: text, ops: [], changes: [], changedShots: [], spill: [], newIssues: [], fixedIssues: [], after: null, committed: false };
      throw e;
    }
    if (!ev.ok || o.dryRun) return { ...ev, committed: false };
    const h = this.project.commit(ev, { role, source: o.source ?? "human" });
    this.events.emit("changed", h);
    return { ...ev, committed: true };
  }

  /** Replace the episode source (e.g. from a code editor). */
  setEpisode(text: string, source: "editor" | "mcp" = "editor") {
    const h = this.project.replaceEpisode(text, { role: "director", source, summary: "edited source" });
    this.events.emit("changed", h);
    return h;
  }

  undo() {
    const h = this.project.undo();
    if (h) this.events.emit("changed", h);
    return h;
  }

  async write(script: string, o: { apply?: boolean } = {}) {
    const r = await writeEpisode(this.project, script, this.llm, this.emit);
    if (r.ok && o.apply) this.setEpisode(r.text);
    return r;
  }

  /** Render temp voices (Kokoro, or walla offline) for every line, then retime the cut to them. */
  async voices(o: { engine?: string; force?: boolean; prune?: boolean } = {}) {
    const engine = pickEngine(o.engine);
    this.emit({ kind: "call", role: "sound", message: `voices: rendering with ${engine.name}` });
    const r = await this.project.renderVoices(engine, { ...o, onProgress: (d, n, line, cached) => this.emit({ kind: "step", role: "sound", message: `${d}/${n} ${cached ? "cached" : "rendered"}: ${line}` }) });
    this.emit({ kind: "done", role: "sound", message: `voices: ${r.made} rendered, ${r.cached} cached, ${r.failed.length} failed; cut ${r.durationBefore.toFixed(1)}s -> ${r.durationAfter.toFixed(1)}s` });
    this.events.emit("changed", null);
    return { ...r, engine: engine.name };
  }

  screen(viewers?: number) { return screen(this.project, this.llm, viewers, this.emit); }

  get qc() { return this.project.ws.qc; }
  get compiled() { return this.project.ws.compiled; }
  get source() { return this.project.episodeSrc; }

  /** The episode with line addresses and timing: what Claude sees. */
  overview(shots?: string[]) {
    return listing(this.project.ws.doc, this.compiled, shots ? new Set(shots) : null);
  }

  bake() { return bake(this.compiled); }
  otio() { return toOtio(this.compiled, `${this.project.show.title} ${this.project.episodeFile}`); }
}

export { Project } from "./project.ts";
export { ClaudeLLM, MODELS, type LLM, type LLMCall, type LLMResult } from "./claude/llm.ts";
export { OfflineLLM } from "./claude/offline.ts";
export { parseEpisode, parseShow, printDoc, printNode, structure, validate } from "./scene/parse.ts";
export { applyPatch, parsePatch, printPatch } from "./scene/patch.ts";
export { compile, bake } from "./scene/compile.ts";
export { runQc } from "./qc/checks.ts";
export { grammarCard, CREW_RULES } from "./crew/prompts.ts";
export { ROLES } from "./crew/roles.ts";
export type { CrewEvent } from "./crew/direct.ts";
