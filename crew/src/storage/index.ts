// Pick the project store. CREW_STORAGE=fs (default); "supabase" is not wired yet.

import { FsStore } from "./fs-store.ts";
import type { ProjectStore } from "./types.ts";

export type { ProjectStore } from "./types.ts";
export { FsStore } from "./fs-store.ts";

export function storeFor(dir: string): ProjectStore {
  const kind = (process.env.CREW_STORAGE || "fs").trim().toLowerCase();
  if (kind === "supabase") throw new Error("Supabase storage is not connected yet; see docs/STORAGE.md");
  if (kind !== "fs") throw new Error(`unknown CREW_STORAGE "${kind}" (use "fs")`);
  return new FsStore(dir);
}
