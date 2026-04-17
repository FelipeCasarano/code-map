# Code Map

**A Code Map + Context Routing plugin for coding agents (Claude Code, Codex, MCP-compatible hosts).**

Code Map builds a small, durable index of your repository - files, symbols, routes, tests, and a weighted dependency graph - and exposes it through cheap, deterministic tools. Agents use those tools to locate code, find related modules, and predict the impact of an edit *without re-reading the repo*. The plugin measures the token cost it saves on every call.

> Zero runtime dependencies. Node 18+. Works on Windows, macOS, Linux.

---

## Why

Agents spend most of their context budget re-discovering the codebase. They grep, they open candidate files, they re-derive imports turn after turn. Code Map does that work once and remembers it.

| Without Code Map | With Code Map |
|---|---|
| `grep` → open 5 candidate files → maybe the right one | `cm resolve login.js` → exact hit, ~0ms, 35 tokens delivered |
| Edit a util → hope nothing breaks | `cm impact src/utils/jwt.js` → ranked list of every file likely affected |
| Re-read the same files next turn | The index is durable; query it again for free |

On the self-benchmark (40 files, 17 tasks) Code Map delivers **98.9% token savings** vs a naive baseline, with **100% locate hit-rate** and **100% impact recall**.

## Install

```bash
git clone https://github.com/FelipeCasarano/code-map .code-map-plugin
node .code-map-plugin/src/cli/index.js sync     # one-time index build
```

Detailed wiring (Claude Code, Codex, MCP, `npm install -g`) lives in [docs/installation.md](docs/installation.md).

## CLI

```bash
cm sync                                 # build/refresh the local index
cm resolve <query>                      # deterministic locator
cm search <query>                       # hybrid lexical search
cm neighbors <target> [--types ...]     # graph neighbors
cm impact <target> [--depth N]          # weighted impact set
cm explain <query>                      # trace which layer answered
cm stats [--session id]                 # token-savings ledger
```

All commands accept `--json` for machine output.

## Tools (for agents)

| Tool | Returns |
|---|---|
| `cm_resolve` | Exact file/symbol/route/test hit with reason and confidence |
| `cm_search` | Ranked summaries from a BM25-lite index over key tokens |
| `cm_neighbors` | Direct graph neighbors of a node |
| `cm_impact` | Ranked file set likely affected by editing the target |
| `cm_explain` | Composed trace - which layer, which candidates, which decision |
| `cm_sync` | Incremental index refresh |
| `cm_stats` | Per-session `raw_candidate_tokens`, `delivered_tokens`, `saved_percent` |

## Skills

Three short skills tell an agent how to use the plugin:

- [`skills/using-code-map`](skills/using-code-map/SKILL.md) - routing rules
- [`skills/updating-code-map`](skills/updating-code-map/SKILL.md) - when to re-sync, when to add an `@cm` anchor
- [`skills/measuring-context-savings`](skills/measuring-context-savings/SKILL.md) - reading and reporting savings

## Anchors (optional but cheap)

```js
// @cm-file domain=auth exports=login,refreshSession routes=POST /login,POST /refresh tests=tests/auth_login.test.js
// @cm id=auth.login role=entry involves=UserRepo,PasswordHasher,JwtService affects=auth.routes,session.refresh
```

Anchors stay short (1-3 lines max). Detail goes in the index.

## Architecture

A 5-layer retrieval stack: deterministic resolver → structural index → weighted graph → lexical search → optional semantic fallback. See [docs/architecture.md](docs/architecture.md).

## Benchmark

```bash
npm run benchmark                       # fixture benchmark
node scripts/benchmark-self.js          # benchmark against this repo
```

Each writes a snapshot to `.code-map/benchmark.json` with per-task hits, recall, latency, and a composite score.

| metric | self benchmark | target |
|---|---|---|
| saved_percent | **0.989** | >= 0.65 |
| locate_hit_rate | **1.000** | >= 0.92 |
| impact_recall | **1.000** | >= 0.90 |
| median_latency_ms | **0** | <= 1500 |
| impact_no_rescan_share | **1.000** | >= 0.80 |
| composite_score | **0.996** | - |

See [docs/REPORT.md](docs/REPORT.md) for the final report and [docs/ITERATIONS.md](docs/ITERATIONS.md) for the score-tracked improvement loop.

## License

MIT.
