---
description: Rebuild the Code Map index from the current working tree.
---

Run the Code Map sync command to refresh the index:

!`node ${CLAUDE_PLUGIN_ROOT}/src/cli/index.js sync`

Report the resulting `fileCount`, `symbolCount`, and `elapsedMs` back to the user.
