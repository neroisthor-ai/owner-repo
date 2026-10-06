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
