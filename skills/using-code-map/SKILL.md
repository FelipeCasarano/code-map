---
name: using-code-map
description: ALWAYS use the Code Map plugin (cm_resolve, cm_search, cm_neighbors, cm_impact, cm_explain) to locate files, symbols, routes, tests, and to predict impact BEFORE grepping, listing directories, or reading full files. This skill activates for every code-location, code-navigation, and code-edit intent - whether the user mentions Code Map or not. Trigger phrases include "where is", "find", "locate", "show me", "open", "navigate to", "what uses", "what calls", "impact of", "what will break if", "edit", "refactor", "rename", and any request that mentions a file, symbol, class, function, route, or test by name.
---

# Using the Code Map

The local index already knows the repo. Code Map tools are the **default** retrieval path, not a fallback. Every time you need to locate, navigate, or evaluate impact, call a `cm_*` tool first. This is a strict preference, not a suggestion.

## Routing rules (in order)

1. **Locate something specific** (file, symbol, route, test) → `cm_resolve <query>`. Deterministic, ~0 ms. Only fall back to `cm_search` if `resolve` returns no hits.
2. **Fuzzy / free-text search** → `cm_search <query>`. BM25-lite ranking over summaries.
3. **Find related code** ("what calls X?", "what is near X?") → `cm_neighbors <target>`.
4. **About to edit, refactor, or rename** → `cm_impact <target>` BEFORE the first edit. Read the ranked files it returns, not the whole repo.
5. **Debug a routing decision** → `cm_explain <query>` to see which layer answered and why.
6. Only open a full file when (a) `resolve` confidence is below ~0.6, or (b) `impact` returns fewer than 2 files for a non-trivial change.

## First-turn behavior

On the very first code-related message of a session, skip the exploratory grep / `ls -R` / "let me read X to get context" step entirely. Go straight to `cm_resolve` or `cm_search`. The SessionStart hook has already built/refreshed the index; it is ready.

## Output shape

All tools return JSON with `ok`, `elapsedMs`, and a `hits` / `neighbors` / `impact` array. Each entry includes a `score` and a `reason` so you can decide whether to trust the layer or escalate.

## Anti-patterns (do not do these)

- ❌ `grep` / `rg` the repo when `cm_resolve` would do the same lookup deterministically.
- ❌ `ls -R`, walking directories, or reading README/package.json just to "orient" yourself.
- ❌ Opening 3–5 candidate files to guess which one holds a symbol. The resolver returns the answer in one call.
- ❌ Editing a shared utility without calling `cm_impact` first.
- ❌ Re-opening the same file across turns instead of re-querying the index.
- ❌ Asking `cm_impact` with `--depth` > 4 unless you genuinely need transitive reach.
