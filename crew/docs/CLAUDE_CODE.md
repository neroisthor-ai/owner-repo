# Working on a film with Claude Code (no API key)

Claude Code on your Claude plan can drive the crew. It reads the episode, makes checked edits with the crew tools, and the editor in your browser updates live. The API and its pay-as-you-go billing are not involved.

## One-time
1. Install Claude Code and sign in with your Claude account: https://docs.claude.com/en/docs/claude-code/setup
2. Node 20 or newer, and git.
3. Get the project and go to the `crew` folder:
   ```bash
   git clone https://github.com/neroisthor-ai/owner-repo.git
   cd owner-repo && git checkout claude/crew-props-sets-library-vfdnbk && cd crew
   ```

## Every time
```bash
npm run claude
```
That installs what is missing, starts the editor at http://localhost:4310, and opens Claude Code in this folder. When Claude Code asks whether to trust the `crew` tools (from `.mcp.json`), approve. Then talk to it:

- "1D, the shock is too long"
- "make 1A warmer and slower"
- "kiran clips through mum at 0:02 in 1A, fix it"
- "check the cut and tell me what is wrong"

Open http://localhost:4310 beside it. Edits show up as they land. Undo is in the editor's title bar, or ask "undo that".

## What Claude can do here
The tools are `crew_overview`, `crew_check`, `crew_patch`, `crew_note`, `crew_accept`, `crew_reject`, `crew_undo`, `crew_set_episode`, `crew_shot_state`, `crew_grammar`, `crew_voices`, `crew_screen`, `crew_library` and `crew_export_otio`. Every change passes the same grammar, permission, locality and QC checks as the in-app crew. `CLAUDE.md` teaches Claude the workflow (narrowest role, patches not rewrites, say what was and was not checked).

## Limits
- The note box inside the editor stays on the offline rules. The Claude brain is the Claude Code window.
- Your plan's usage limits apply, not per-token billing.
- Timeline edits (your own sounds, pictures, green screen) are made in the editor, not through Claude.

## Claude Desktop and Cowork
Same crew tools, no terminal for Claude itself. You still run the editor once in a terminal (`npm install`, then `npm start`) and keep http://localhost:4310 open.

1. In the Claude desktop app open Settings, then Developer, then Edit Config. That opens `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`).
2. Add the crew server with absolute paths to your clone, then restart the app:
   ```json
   { "mcpServers": { "crew": { "command": "node", "args": ["/FULL/PATH/owner-repo/crew/bin/crew.js", "mcp", "/FULL/PATH/owner-repo/crew/shows/kitchen"] } } }
   ```
   On Windows use `C:\\Users\\you\\owner-repo\\crew\\...` with doubled backslashes.
3. In Cowork, give it the `crew` folder as its working folder, and paste:
   > You are the crew for the film in this folder. Read CLAUDE.md first. Use the crew tools: crew_overview before anything, crew_patch with the narrowest role for edits, crew_check after every change, and tell me what was and was not checked. Never rewrite a whole episode for a note. Start with crew_overview and tell me what you see.
4. If Cowork does not show the crew tools, it can still work from the folder: the film is plain text (`shows/kitchen/ep01.scene`), and with a shell it can run `npx tsx src/cli.ts check` and `npx tsx src/cli.ts patch "1D.2 ~2.5 -> ~1.4" --role animator`, which apply the same checks.
