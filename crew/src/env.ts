// Loads crew/.env before any other module reads its settings. Import it first: module-level constants (model ids,
// Pro mode, ladders) are read when their modules load, so a later loadEnvFile is too late for them.
import { join } from "node:path";
import { fileURLToPath } from "node:url";

try { process.loadEnvFile(join(fileURLToPath(new URL("..", import.meta.url)), ".env")); } catch { /* no .env yet: Crew AI is set up from the UI or the environment */ }
