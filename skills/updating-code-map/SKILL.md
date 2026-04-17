---
name: updating-code-map
description: Keep the Code Map index fresh and add short @cm anchors so future queries route faster. Trigger after writing or moving source files, adding a new public symbol, or renaming code. Note - the plugin already auto-syncs after every Edit/Write via a PostToolUse hook, so manual syncs are only needed when editing outside the agent or when suspecting index corruption.
---

# Updating the Code Map

Two responsibilities: keep the index fresh, and drop short anchors so the next query routes faster.

## Sync

- **The plugin auto-syncs.** A `PostToolUse` hook runs `cm sync --silent` after every Edit / Write / MultiEdit / NotebookEdit. You do not need to call `cm_sync` manually after an in-agent edit.
- Call `cm_sync` manually only when: (a) files changed outside the agent (git pull, external editor), (b) you suspect index corruption, or (c) you rely on impact results right after a bulk non-tool edit.
- Pass `--force` only when you suspect index corruption.
- After a rename or large refactor, `cm sync --force` is safe and cheap.

## Anchors

Anchors are **short** structured comments. They never duplicate what the function name already says.

- File header (one per file, optional):
  `// @cm-file domain=<area> exports=<symbol[,symbol]> routes=<HTTP /path[,...]> tests=<rel/path>`
- Function or orchestration site:
  `// @cm id=<stable.id> role=<entry|read|write|route|orchestration> involves=<symA,symB> affects=<surfaceA,surfaceB>`

Rules:
- Maximum 1-3 useful lines.
- Limit `involves` and `affects` to the most important nodes - the rest stays in the index.
- Use stable ids (`auth.login`, not `loginV2`). Rename intentionally.
- Skip anchors on private helpers and trivial getters.

## When NOT to add an anchor

- The function name already encodes everything an agent needs.
- The file has fewer than ~30 lines and only one export.
- You would be repeating the file's `@cm-file` header.
