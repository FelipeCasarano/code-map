---
description: Trace which retrieval layer answered a query and why.
argument-hint: <query>
---

Run Code Map's explain trace for `$ARGUMENTS`:

!`node ${CLAUDE_PLUGIN_ROOT}/src/cli/index.js explain "$ARGUMENTS" --json`

Report the layer (resolver / graph / search), the candidates considered, and the final decision.
