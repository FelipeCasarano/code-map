# Architecture

Code Map is a layered retrieval system. Each layer answers a question more cheaply than the next, and only escalates if its confidence is too low.

```
        +-----------------------------------------------+
query → | 1. Resolver (deterministic exact / suffix)    | → hit? return.
        +-----------------------------------------------+
                   ↓ miss
        +-----------------------------------------------+
        | 2. Structural index + alias map               | → hit? return.
        +-----------------------------------------------+
                   ↓ miss
        +-----------------------------------------------+
        | 3. Lexical search (BM25-lite over summaries)  | → return ranked hits.
        +-----------------------------------------------+
                   ↓ optional
        +-----------------------------------------------+
        | 4. Semantic fallback (off by default)         |
        +-----------------------------------------------+
        | 5. Benchmark + session ledger                 | (always recording)
        +-----------------------------------------------+
```

## Components

| Module | Role |
|---|---|
| `src/core/scanner.js` | Walks tracked files, ignoring vendor/build dirs |
| `src/core/parser.js` | Extracts symbols, imports, routes, tests, anchors per file |
| `src/core/anchors.js` | Parses `@cm` and `@cm-file` short comments |
| `src/core/graph.js` | Weighted directed multigraph with BFS impact queries |
| `src/core/indexer.js` | Orchestrates scan → parse → graph → write JSONL artifacts |
| `src/core/resolver.js` | Layer 1+2: exact path, basename, symbol, route, alias |
| `src/core/search.js` | Layer 3: BM25-lite over key tokens, with anchor/role boosts |
| `src/core/neighbors.js` | Direct graph neighbors of a node |
| `src/core/impact.js` | Weighted BFS that projects symbol/file nodes to a ranked file set |
| `src/core/explain.js` | Composes resolver + search + neighbors + impact for diagnostics |
| `src/core/stats.js` | Per-session token-savings ledger |
| `src/core/tokens.js` | Tokenizer-agnostic token estimator (~3.6 chars/token) |
| `src/core/db.js` | JSON / JSONL store under `.code-map/` |
| `src/cli/index.js` | CLI entry: `cm sync`, `cm resolve`, ... |
| `src/adapters/*.js` | Claude Code / Codex / generic stdio shims |
| `src/mcp/server.js` | Minimal MCP-flavoured JSON-RPC server |
| `scripts/benchmark.js` | Fixture benchmark vs naive baseline |
| `scripts/benchmark-self.js` | Larger benchmark against the plugin's own repo |

## Graph

- Node types: `file`, `symbol`, `module`, `route`, `job`, `test`, `schema`, `event`, `query`, `migration`, `config`.
- Edge types: `imports`, `calls`, `called_by`, `depends_on`, `reads`, `writes`, `emits`, `consumes`, `tested_by`, `shares_schema`, `configured_by`, `changes_with`, `affects`.
- Every edge carries `weight`, `reason`, `confidence`, `last_seen`. Impact BFS multiplies score by `decay * weight * confidence` per hop.

## Storage

`.code-map/` per repo:

| file | contents |
|---|---|
| `index.json` | file-level metadata keyed by relative path; includes parser cache for incremental sync |
| `symbols.jsonl` | one symbol per line: function/class/method/route/test |
| `summaries.jsonl` | per-file compact summary (key tokens, headline symbols, anchors) |
| `aliases.jsonl` | lowercase alias → list of hits for the resolver |
| `graph.json` | dump of the weighted graph |
| `benchmark.json` | latest benchmark snapshot |
| `version.json` | schema version + last-built fingerprint |
| `sessions/<id>.jsonl` | per-session stats ledger |

The directory is gitignored except for `template.json`, which documents the layout.

## Why no native dependencies

The plugin targets fast install through GitHub. SQLite is on the roadmap as an opt-in backend (the storage layer in `db.js` is a thin wrapper that can swap implementations), but JSONL + a JSON file keep installation to `npm install` with no compile step. On the self-benchmark (40 files, 21k tokens) sync runs in under 20ms; this scales linearly and stays sub-second up to a few thousand files. SQLite + FTS5 will become valuable beyond that scale.

## Anchors

Anchors are short structured comments. They never duplicate the function name; they only add what is hard to derive: the role of a function, the modules it touches, and the surfaces it can affect. Richer detail lives in the index, never in the comment.

```
// @cm-file domain=auth exports=login,refreshSession routes=POST /login,POST /refresh tests=tests/auth_login.test.js
// @cm id=auth.login role=entry involves=UserRepo,PasswordHasher,JwtService affects=auth.routes,session.refresh
```

## Token-savings model

For each tool call we record:

- `raw_candidate_tokens`: tokens the naive baseline would have shipped (it opens whole candidate files).
- `delivered_tokens`: tokens of the compact response we actually return.
- `saved_tokens = max(0, raw - delivered)`.
- `saved_percent = saved / raw`.

Latency is measured around the whole tool entrypoint and rolled into a `latency_score` for the composite. A composite `score = 0.35*savings + 0.25*locate_hit_rate + 0.20*impact_recall + 0.10*latency + 0.10*stability` is used to keep or roll back each iteration.
