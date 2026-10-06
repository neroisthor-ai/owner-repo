// Structured context handed to every LLM call alongside the prompt text.
// Claude reads the prompt; the offline crew (and tests) read this.

import type { BodyNode, Show, ShotHeader } from "../scene/ast.ts";
import type { QcIssue } from "../qc/checks.ts";
import type { RoleId } from "../scene/registry.ts";
import type { RawTake } from "./schema.ts";

export interface ShotCtx {
  id: string;
  header: ShotHeader;
  body: { addr: string; node: BodyNode }[];
  dur: number;
  cutDur: number;
  trimHead: number;
  trimTail: number;
  hold: number;
  present: string[];
  set: string;
  /** the most important characters seen in this shot, in order */
  cast: string[];
  /** compiled beat timing, local seconds */
  beats: { addr: string; t0: number; t1: number; kind: string }[];
}

export interface RouteCtx {
  note: string;
  refs: string[];
  shots: ShotCtx[];
  issues: QcIssue[];
}

export interface ProposeCtx {
  role: RoleId;
  note: string;
  intent: string;
  targets: ShotCtx[];
  issues: QcIssue[];
  show: Show;
  failures: string[];
  candidates?: RawTake[];
  /** which proposer this is in a parallel fan-out (offline uses it to vary takes) */
  seed: number;
}

export interface DirectCtx {
  note: string;
  takes: { purpose: string; patch: string; changed: string[]; fixed: number; added: number }[];
  pushback: string | null;
  idea: string | null;
}

export interface ScreenCtx {
  persona: string;
  shots: { id: string; cutDur: number; lines: number; words: number; moves: number; reactions: number }[];
}
