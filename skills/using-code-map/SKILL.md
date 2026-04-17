---
name: using-code-map
description: Use the Code Map plugin to locate files, symbols, routes, and impacted modules without reading the whole repository. Trigger when the user asks to find code, edit a symbol, or assess what an edit will affect.
---

# Using the Code Map

The local index already knows your repo. Reach for it before opening files.

## Routing rules

1. **Locate something specific** (file, symbol, route, test) → call `cm resolve <query>` (the deterministic resolver). Only fall back to `cm search` if `resolve` returns no hits.
2. **Find related code** ("what calls X?", "what is near X?") → call `cm neighbors <target>`.
3. **About to edit** → call `cm impact <target>` to get the ranked set of likely-affected files. Read those, not the whole repo.
4. **Confused about why a result was chosen** → call `cm explain <query>`.
5. Only open a full file when (a) `resolve` confidence is below ~0.6, or (b) `impact` returns fewer than 2 files for a non-trivial change.

## Output shape

All tools return JSON with `ok`, `elapsedMs`, and a `hits` / `neighbors` / `impact` array. Each entry includes a `score` and a `reason` so you can decide whether to trust the layer or escalate.

## Anti-patterns

- Do not grep the repo when `cm resolve` would do the same lookup with deterministic ranking.
- Do not re-open files between turns. The index is durable; query it again instead.
- Do not request `cm impact` with `--depth` greater than 4 unless you genuinely need transitive reach. Deeper queries cost more without improving recall on most projects.
