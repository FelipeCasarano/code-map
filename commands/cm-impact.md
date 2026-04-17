---
description: Show the ranked set of files likely affected by editing a target.
argument-hint: <path-or-symbol>
---

Compute the weighted impact set for `$ARGUMENTS`:

!`node ${CLAUDE_PLUGIN_ROOT}/src/cli/index.js impact "$ARGUMENTS" --json`

Report the ranked list of files, their edge weights, and the reason each one entered the set.
