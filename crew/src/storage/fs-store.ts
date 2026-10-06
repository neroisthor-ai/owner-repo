// Filesystem store: plain files under the project dir, exactly the on-disk layout.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ProjectStore } from "./types.ts";

export class FsStore implements ProjectStore {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }

  private abs(p: string) { return join(this.root, p); }

  readText(path: string) { const f = this.abs(path); return existsSync(f) ? readFileSync(f, "utf8") : null; }
  writeText(path: string, text: string) { this.mkdirp(dirname(path)); writeFileSync(this.abs(path), text); }
  appendText(path: string, text: string) { this.mkdirp(dirname(path)); appendFileSync(this.abs(path), text); }
  list(dir: string) { const d = this.abs(dir); return existsSync(d) ? readdirSync(d) : []; }
  exists(path: string) { return existsSync(this.abs(path)); }
  mkdirp(dir: string) { mkdirSync(this.abs(dir), { recursive: true }); }
  readBytes(path: string) { const f = this.abs(path); return existsSync(f) ? new Uint8Array(readFileSync(f)) : null; }
  writeBytes(path: string, bytes: Uint8Array) { this.mkdirp(dirname(path)); writeFileSync(this.abs(path), bytes); }
}
