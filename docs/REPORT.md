# Final Report

## Goal

Ship a Code Map + Context Routing plugin that:
1. resolves files / symbols / routes / tests with high precision,
2. builds a weighted impact map of the repo,
3. uses short structured anchors as navigation hints,
4. measures real token savings against a naive baseline,
5. uses its own routing strategy to maintain itself.

## What was delivered

| Area | Artifact |
|---|---|
| Core | `src/core/{scanner,parser,anchors,graph,indexer,resolver,search,neighbors,impact,explain,stats,tokens,db,paths,index}.js` |
| CLI | `src/cli/index.js` (`cm sync`/`resolve`/`search`/`neighbors`/`impact`/`stats`/`explain`/`help`) |
| Adapters | `src/adapters/{generic,claude-code,codex}.js`, `src/mcp/server.js` |
| Configs | `configs/{claude-code,codex,mcp}.json` |
| Skills | `skills/{using-code-map,updating-code-map,measuring-context-savings}/SKILL.md` |
| Benchmarks | `scripts/benchmark.js` (fixture), `scripts/benchmark-self.js` (this repo) |
| Tests | `tests/run.js` (zero-dep test runner, 9 cases) + `tests/fixtures/sample-project/` |
| Docs | `README.md`, `docs/architecture.md`, `docs/installation.md`, `docs/ITERATIONS.md`, this report |
| Example | `examples/tiny-app/` (greenfield install path) |
| Storage layout | `.code-map/` with `index.json`, `symbols.jsonl`, `summaries.jsonl`, `aliases.jsonl`, `graph.json`, `benchmark.json`, `version.json`, `sessions/` |

## Targets vs results

All numeric targets met on the larger self benchmark:

| target | bound | result |
|---|---|---|
| median token savings | >= 65% | **98.90%** |
| top-3 hit-rate (locate file/symbol) | >= 92% | **100%** |
| impact recall on edits | >= 90% | **100%** |
| median resolution latency | <= 1500 ms | **0 ms** |
| share of edits answered without rescan | >= 80% | **100%** |
| critical regressions | 0 | **0** (9/9 tests pass) |

Composite score: **0.9962** on the self benchmark, **0.9457** on the smaller fixture (smaller corpus, baseline cost is closer to delivered cost so savings are lower).

## Self-hosting

Phase 3 was carried out by using the plugin against its own source code. After the MVP indexed the repo (`cm sync` → 40 files in 15 ms), every subsequent investigation - including the two iterations described below - was driven by `cm resolve`, `cm impact`, and `cm explain` rather than full-file reads.

## Iteration log

| # | hypothesis | change | composite (self) | impact_recall (self) | decision |
|---|---|---|---|---|---|
| 0 | baseline | - | 0.9280 | 0.6533 | start |
| 1 | graph builder drops late-resolved import edges because file nodes are added in the same pass that adds edges | split `buildGraph` into pass-1 (nodes) + pass-2 (edges) in `src/core/graph.js` | 0.9836 | 0.9333 | KEEP |
| 2 | impact projection caps the underlying set, so cross-file files lose their slots to intra-file symbols | request `rawLimit = max(fileLimit*6, 60)` from `graph.impact()` in `src/core/impact.js`, then trim file projection | 0.9962 | 1.0000 | KEEP |

Two iterations cleared every threshold. Further iterations against the current corpus would chase noise; the productive next step is to grow the benchmark suite (see "Next steps").

## Limitations

- **Lexical-only retrieval.** Layer 4 (semantic embeddings) is intentionally not implemented. The plugin works without an embedding service. A pluggable embedding fallback is on the roadmap and does not change the public tool surface.
- **JSON storage.** SQLite is described in the architecture as the long-term default; the current storage layer uses JSON + JSONL to keep `npm install` dependency-free. The `Store` class in `src/core/db.js` is a thin wrapper meant to be swapped without touching callers.
- **Regex parsers.** Symbol extraction is pragmatic regex per language, not a full AST. This handles common JS/TS/Python/Go/Rust patterns and degrades gracefully on exotic syntax. Tree-sitter is the natural upgrade path.
- **Benchmark scale.** The self benchmark is 40 files; targets pass with margin but the variance is small at this scale. A multi-repo harness (real OSS projects of varying sizes) would stress-test the impact graph and lexical ranker in ways the current suite cannot.
- **Anchor adoption is voluntary.** Without `@cm` anchors the plugin still works (graph and resolver carry the load), but anchor-derived edges are how the system becomes faster than grep on really large monorepos. The "updating-code-map" skill exists to keep adoption cheap.

## Next steps (prioritized)

1. **Multi-repo benchmark.** Add 3-4 mid-sized OSS projects (one TS web app, one Python service, one Go service). Re-baseline the composite there; expect impact_recall to fall and use that signal to drive iterations 3+.
2. **SQLite + FTS5 backend.** Behind the `Store` interface. Becomes worth the build-toolchain cost beyond ~5k files.
3. **Tree-sitter parsers** for JS/TS, Python, Go, Rust. Replaces the regex symbol extractor and unlocks proper call-graph edges (currently we infer at file granularity).
4. **Optional embedding fallback.** Plug a local sentence-transformer (or remote embedding API) in as Layer 4. Off by default; only triggered when Layers 1-3 all miss.
5. **Editor integrations.** A VSCode hover + jump-to that calls `cm resolve` and `cm neighbors` directly, sharing the same `.code-map/`.

## Composite-score rationale

`score = 0.35 * savings + 0.25 * locate_hit_rate + 0.20 * impact_recall + 0.10 * latency_score + 0.10 * stability_score`. Savings carries the largest weight because the project goal is to reduce context cost; locate hit-rate is next because a wrong answer is worse than a slow one; impact recall is the third lever because that is what unlocks "edit safely without re-reading the repo"; latency and stability are tie-breakers that prevent the loop from gaming any of the top three.
