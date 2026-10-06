// Where a show's text files live. Paths are relative to the project root, with
// "/" separators. Synchronous because Project is synchronous. A remote store
// (Supabase) needs a sync cache (load on open, write-through in the background)
// or an async Project; see docs/STORAGE.md.

export interface ProjectStore {
  /** File text, or null if the file does not exist. */
  readText(path: string): string | null;
  /** Create or replace a file, creating parent dirs. */
  writeText(path: string, text: string): void;
  /** Append to a file, creating it (and parent dirs) if needed. */
  appendText(path: string, text: string): void;
  /** Names (not paths) directly inside dir; [] if dir is missing. */
  list(dir: string): string[];
  exists(path: string): boolean;
  mkdirp(dir: string): void;
  readBytes?(path: string): Uint8Array | null;
  writeBytes?(path: string, bytes: Uint8Array): void;
}
