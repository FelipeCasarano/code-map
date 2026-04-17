---
description: Deterministically locate a file, symbol, route, or test by name.
argument-hint: <query>
---

Use the Code Map resolver to locate `$ARGUMENTS`.

!`node ${CLAUDE_PLUGIN_ROOT}/src/cli/index.js resolve "$ARGUMENTS" --json`

Return the top hit(s) with `path`, `kind`, `reason`, and `confidence`. If the resolver returns no hit, fall back to `cm search "$ARGUMENTS" --json`.
