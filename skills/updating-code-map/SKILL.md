---
name: updating-code-map
description: Refresh the Code Map index after editing files, and add short @cm anchors so future queries route faster. Trigger after writing or moving source files, or when adding a new public symbol.
---

# Updating the Code Map

Two responsibilities: keep the index fresh, and drop short anchors so the next query routes faster.

## Sync

- Run `cm sync` after a batch of edits. The sync is incremental (uses mtime + size); only changed files are re-parsed.
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
