Set up "tipshare" — a shared, topic-based tips/lessons-learned store for AI
agents — so this project reads and writes it.

This is a copy-paste prompt for a Claude Code session. Replace
`<tipshare-repo>` with the absolute path to your tipshare checkout
(the folder containing `dist/server.js`), and `<short-id>` with a short,
stable agent id for this project (e.g. the game's name, like "tiny-invasion").

CONTEXT
- The server is already built at `<tipshare-repo>/dist/server.js`. If that
  path does not exist, run `npm run build` in `<tipshare-repo>` first — do
  not try to rebuild anything here.
- Shared data lives in `~/.tipshare/tipshare.db` (one SQLite store, shared
  by every agent on the machine).
- Commands and the agent workflow text live in the tipshare checkout so they
  never drift from this document.

SCOPE: modify ONLY these files in THIS project, nothing else (no other edits,
no commits): `.mcp.json`, `.claude/commands/share.md`,
`.claude/commands/tips.md`, and `CLAUDE.md`.

DO THE FOLLOWING, IN ORDER:

1. Register the MCP server. Create (or merge into) `.mcp.json` in THIS
   project's root, without clobbering any existing servers:

   {
     "mcpServers": {
       "tipshare": {
         "command": "node",
         "args": ["<tipshare-repo>/dist/server.js"],
         "env": { "TIPSHARE_AGENT_ID": "<short-id>" }
       }
     }
   }

2. Install the slash commands from the tipshare checkout:

   mkdir -p .claude/commands
   cp "<tipshare-repo>/claude/commands/share.md" .claude/commands/share.md
   cp "<tipshare-repo>/claude/commands/tips.md" .claude/commands/tips.md

   (These are user-facing commands; the agent also follows the workflow
   instructions below without them.)

3. Install the agent workflow: append the FULL contents of
   `<tipshare-repo>/instructions/AGENT.md` to the END of this project's
   CLAUDE.md (create CLAUDE.md if missing). It covers when to read the feed,
   when to publish, the verification reflex (`mark_outcome`), superseding
   outdated tips, and identity. If reads outside this project are blocked,
   ask the user to run the copy instead.

4. Verify and report. Run: claude mcp list
   Confirm "tipshare" is listed and that the "help" and "get_tip" tools are
   both present.

Finally, tell me to restart Claude Code. Note: a newly added MCP server shows
as "pending approval" after restart — approve it once (or answer its prompt)
and the tools will load.