import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "../src/project.ts";
import { parsePatch } from "../src/scene/patch.ts";
import { storeFor } from "../src/storage/index.ts";
import type { ProjectStore } from "../src/storage/types.ts";

const SHOW = join(import.meta.dirname, "..", "shows", "kitchen");

class MemStore implements ProjectStore {
  files = new Map<string, string>();
  readText(p: string) { return this.files.get(p) ?? null; }
  writeText(p: string, t: string) { this.files.set(p, t); }
  appendText(p: string, t: string) { this.files.set(p, (this.files.get(p) ?? "") + t); }
  list(dir: string) {
    const pre = dir === "." || dir === "" ? "" : dir.replace(/\/$/, "") + "/";
    return [...new Set([...this.files.keys()].filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length).split("/")[0]))];
  }
  exists(p: string) { return this.files.has(p) || this.list(p).length > 0; }
  mkdirp() {}
}

test("Project runs patch and undo on an in-memory store without touching disk", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "crew-mem-")), "nowhere");
  const mem = new MemStore();
  mem.writeText("show.scene", readFileSync(join(SHOW, "show.scene"), "utf8"));
  mem.writeText("ep01.scene", readFileSync(join(SHOW, "ep01.scene"), "utf8"));
  const p = new Project(dir, undefined, mem);
  assert.deepEqual(p.episodes, ["ep01.scene"]);
  const before = p.episodeSrc;
  const ev = p.check(parsePatch("1D.2 ~2.5 -> ~1.5"), { role: "animator", allowed: null });
  assert.ok(ev.ok, ev.reasons.join("; "));
  const h = p.commit(ev, { role: "animator", source: "human" });
  assert.notEqual(p.episodeSrc, before);
  assert.match(mem.readText("ep01.scene")!, /kiran shock ~1.5/);
  assert.ok(mem.readText(`.crew/snapshots/${h.id}.scene`));
  assert.equal(mem.readText(".crew/history.jsonl")!.trim().split("\n").length, 1);
  assert.equal(p.undo()?.id, h.id);
  assert.equal(p.episodeSrc, before);
  assert.equal(mem.readText(".crew/history.jsonl"), "");
  assert.equal(existsSync(dir), false);
});

test("CREW_STORAGE=supabase fails clearly; default is fs", () => {
  const old = process.env.CREW_STORAGE;
  try {
    process.env.CREW_STORAGE = "supabase";
    assert.throws(() => storeFor(SHOW), /Supabase storage is not connected yet; see docs\/STORAGE\.md/);
    delete process.env.CREW_STORAGE;
    assert.ok(storeFor(SHOW).exists("show.scene"));
  } finally {
    if (old === undefined) delete process.env.CREW_STORAGE; else process.env.CREW_STORAGE = old;
  }
});
