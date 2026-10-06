# Storage

All of a show's text files go through a `ProjectStore` (`src/storage/types.ts`). Today that is the filesystem (`src/storage/fs-store.ts`). `storeFor(dir)` in `src/storage/index.ts` picks it from `CREW_STORAGE` (default `fs`; `supabase` throws until an adapter exists).

## What is stored where

Paths are relative to the show dir (`shows/<show>/`).

| Path | Holds |
| --- | --- |
| `show.scene` | Show bible (cast, sets, look). Read only by the crew. |
| `epNN.scene` | Episode SCENE source. Rewritten on every commit and undo. |
| `.crew/history.jsonl` | One JSON `HistoryEntry` per applied patch. Append-only, rewritten on undo. |
| `.crew/snapshots/<id>.scene` | Episode text before each commit, used by undo. |
| `.crew/notes.jsonl` | `NoteRecord`s, append-only, last record per id wins (also feeds taste memory). |
| `.crew/llm-log.jsonl` | Gemini call log (`src/index.ts`), written directly to disk. |
| `voices/voices.json`, `voices/*.wav` | Voice bank index and rendered clips. Still direct disk (`src/voice/bank.ts`), served at `/show-media/voices/`. |

## Interface

```ts
interface ProjectStore {
  readText(path: string): string | null;   // null when missing
  writeText(path: string, text: string): void;
  appendText(path: string, text: string): void;
  list(dir: string): string[];             // names directly inside dir, [] if missing
  exists(path: string): boolean;
  mkdirp(dir: string): void;
  readBytes?(path: string): Uint8Array | null;
  writeBytes?(path: string, bytes: Uint8Array): void;
}
```

`new Project(dir, episode?, store?)` takes the store; omitted means the fs store at `dir`.

## Why it is synchronous

`Project` is synchronous and so is everything above it (guard, MCP tools, server handlers). A network store cannot block, so pick one:

1. Sync cache (recommended first step). On open, load every text file under the show into memory (`load()` is async, called before `new Project`). The adapter serves reads from the cache, applies writes to it at once, and queues write-through to Supabase in the background, with `flush()` awaited on shutdown and after each commit in the server.
2. Async refactor. Make `ProjectStore` return promises and push `await` through Project, Crew, mcp and server. Cleaner, larger.

## Adding a Supabase adapter

1. Add `@supabase/supabase-js` and create `src/storage/supabase-store.ts` implementing `ProjectStore` (cache approach above).
2. Layout, either of:
   - Table `project_files(project_id uuid, path text, body text, updated_at timestamptz, primary key (project_id, path))`. `appendText` is read-modify-write on `body`, or a `project_log` table with one row per jsonl line for history and notes.
   - Storage bucket `projects` with objects at `<project_id>/<path>`. Good for `.wav` and `readBytes/writeBytes`.
3. Env vars: `SUPABASE_URL`, plus `SUPABASE_SERVICE_ROLE_KEY` for the server (bypasses RLS, never ship to the browser) or `SUPABASE_ANON_KEY` with a user session so RLS applies.
4. Auth: add RLS on `project_files` keyed by `project_id` membership (`auth.uid()`); the server uses the service key and checks membership itself.
5. In `storeFor`, replace the `supabase` throw with the adapter, keyed by project id (the show dir name).
6. Move the voice bank onto `readBytes/writeBytes` and `llm-log.jsonl` onto the store, so nothing is left on local disk.
7. Test with the in-memory store pattern in `test/storage.test.ts`.
