# Iteration Log

Each row records the hypothesis, the change, the benchmark before/after, and the keep/rollback decision.
The composite score is `0.35 * token_savings + 0.25 * locate_hit_rate + 0.20 * impact_recall + 0.10 * latency_score + 0.10 * stability_score`.

The `self` benchmark (`scripts/benchmark-self.js`) runs against the plugin's own repo - it is the more realistic harness.
The `fixture` benchmark (`scripts/benchmark.js`) uses `tests/fixtures/sample-project` and is small enough to flatline at 1.0 once correctness lands.

## Iteration 0 - MVP baseline

| metric | fixture | self |
|---|---|---|
| saved_percent | 0.8551 | 0.9924 |
| locate_hit_rate | 1.0000 | 1.0000 |
| impact_recall | 1.0000 | 0.6533 |
| median_latency_ms | 0 | 0 |
| composite_score | 0.9493 | 0.9280 |

- Hypothesis: end-to-end pipeline works, but graph traversal is the obvious next gap.
- Change: none - this is the starting point.
- Decision: baseline; iterate.

## Iteration 1 - Fix dropped import edges (graph builder ordering)

- Hypothesis: `buildGraph` adds edges referencing file nodes that have not been registered yet, because file nodes are added in the same pass that iterates imports. Late-scanned files lose their incoming `imports` / `called_by` edges.
- Change: split `buildGraph` into two passes - register every `file::` node first, then attach symbols/routes/tests/imports/anchors. (`src/core/graph.js`)
- Files touched: `src/core/graph.js`
- Tests: 9/9 pass.
- self benchmark before: composite=0.9280, impact_recall=0.6533
- self benchmark after:  composite=0.9836, impact_recall=0.9333
- Decision: KEEP. The fix removes a silent correctness bug; +0.056 composite, +0.28 impact_recall, no regression.

## Iteration 2 - Wider raw impact set before file projection

- Hypothesis: `cm_impact` projects graph nodes to files but caps the underlying graph traversal at the same limit. Intra-file symbol nodes consume slots and squeeze out cross-file files that live 2+ hops away.
- Change: in `impact.js`, request `rawLimit = max(fileLimit * 6, 60)` from `graph.impact()`, then trim the projected file list to `fileLimit`. (`src/core/impact.js`)
- Files touched: `src/core/impact.js`
- Tests: 9/9 pass.
- self benchmark before: composite=0.9836, impact_recall=0.9333
- self benchmark after:  composite=0.9962, impact_recall=1.0000
- Decision: KEEP. +0.013 composite, recall hits the ceiling, latency unaffected, savings drop is negligible (~0.2%) and explained by the slightly larger delivered payload.

## Final state

All target thresholds met or exceeded on the self benchmark:

| target | value | bound |
|---|---|---|
| saved_percent | 0.9890 | >= 0.65 |
| locate_hit_rate | 1.0000 | >= 0.92 |
| impact_recall | 1.0000 | >= 0.90 |
| median_latency_ms | 0 | <= 1500 |
| impact_no_rescan_share | 1.0000 | >= 0.80 |
| stability | 9/9 tests pass | zero critical regression |

Two iterations were sufficient to clear every numeric goal. Further iterations would chase noise on this corpus; the next high-leverage work is broadening the benchmark with larger third-party repos and multi-language fixtures (see `docs/REPORT.md` for the prioritized backlog).
