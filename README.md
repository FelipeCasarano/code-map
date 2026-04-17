# Code Map

**A Code Map + Context Routing plugin for coding agents (Claude Code, Codex, MCP-compatible hosts).**

Code Map builds a small, durable index of your repository - files, symbols, routes, tests, and a weighted dependency graph - and exposes it through cheap, deterministic tools. Once installed, your agent uses those tools *automatically* to locate code, find related modules, and predict the impact of an edit **before** reading the repo. The plugin measures the token cost it saves on every call.

> Zero runtime dependencies. Node 18+. Works on Windows, macOS, Linux.

---

## Why

Agents spend most of their context budget re-discovering the codebase. They grep, they open candidate files, they re-derive imports turn after turn. Code Map does that work once and remembers it.

| Without Code Map | With Code Map |
|---|---|
| `grep` → open 5 candidate files → maybe the right one | `cm resolve login.js` → exact hit, ~0 ms, ~35 tokens delivered |
| Edit a util → hope nothing breaks | `cm impact src/utils/jwt.js` → ranked list of every file likely affected |
| Re-read the same files next turn | The index is durable; query it again for free |

On the self-benchmark (40 files, 17 tasks) Code Map delivers **98.9% token savings** vs a naive baseline, with **100% locate hit-rate** and **100% impact recall**.

---

## Install

Pick your host. Each guide is **two commands or one JSON snippet**, copy-pasteable, and leaves you with a working plugin — skills, commands, hooks, and MCP tools all wired automatically.

> Requirements: Node 18+ on your PATH. Nothing else — Code Map has zero runtime dependencies.

### Claude Code

Run from inside a Claude Code session (anywhere, any project):

```text
/plugin marketplace add FelipeCasarano/code-map
/plugin install code-map@code-map
```

Claude Code clones the repo, reads `.claude-plugin/plugin.json`, and activates:

- **3 skills** (`using-code-map`, `updating-code-map`, `measuring-context-savings`) that teach the agent to prefer `cm_*` over grep.
- **5 slash commands**: `/cm-sync`, `/cm-resolve`, `/cm-impact`, `/cm-stats`, `/cm-explain`.
- **SessionStart hook** — `cm sync` runs silently at the top of every session.
- **MCP server** — the seven `cm_*` tools appear natively in the tool picker.

To confirm: type `/plugin` inside Claude Code — `code-map` should appear as enabled. Upgrade with `/plugin marketplace update code-map && /plugin install code-map@code-map`.

---

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) and add:

```json
{
  "mcpServers": {
    "code-map": {
      "command": "npx",
      "args": ["-y", "code-map", "mcp"],
      "env": { "CM_SESSION": "claude-desktop" }
    }
  }
}
```

Restart Claude Desktop. The seven `cm_*` tools appear under the 🔌 MCP icon.

---

### Codex / Codex-CLI

```bash
git clone https://github.com/FelipeCasarano/code-map.git .code-map-plugin
codex plugin add ./.code-map-plugin --config configs/codex.json
```

`configs/codex.json` registers the same seven tools and declares `bootstrap: node src/cli/index.js sync`, so Codex re-syncs the index on plugin start.

---

### Google Antigravity

Open Antigravity → Settings → MCP Servers → **Add server** → paste:

```json
{
  "mcpServers": {
    "code-map": {
      "command": "npx",
      "args": ["-y", "code-map", "mcp"],
      "env": { "CM_SESSION": "antigravity" }
    }
  }
}
```

(A ready-to-copy file is at `configs/antigravity.json`.) Antigravity auto-discovers the tool surface after restart.

---

### Cursor

Edit `~/.cursor/mcp.json` (user-scope) or `.cursor/mcp.json` (project-scope) and add the same snippet as Claude Desktop above. Cursor reloads MCP servers on save.

---

### Continue / Cline / Zed / any other MCP host

Every MCP-compatible host accepts the standard `mcpServers` object. Paste this into your host's MCP config — done:

```json
{
  "mcpServers": {
    "code-map": {
      "command": "npx",
      "args": ["-y", "code-map", "mcp"],
      "env": { "CM_SESSION": "mcp" }
    }
  }
}
```

The server speaks the full MCP handshake (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`, `shutdown`) and publishes JSON-Schema `inputSchema` for every tool, so the host picks them up automatically.

---

### Manual / development install

If you're hacking on Code Map itself or want the CLI without any agent:

```bash
git clone https://github.com/FelipeCasarano/code-map.git .code-map-plugin
node .code-map-plugin/src/cli/index.js sync
```

That builds the index under `.code-map/` in your project. The repo's `.gitignore` already excludes generated artifacts. Put `cm` on your PATH with:

```bash
npm install --no-save ./.code-map-plugin
# now `cm resolve ...`, `cm impact ...` work without the node prefix
```

---

## Verify

**Inside Claude Code** — run the slash commands:

```text
/cm-sync        → { "fileCount": N, "symbolCount": …, "elapsedMs": … }
/cm-resolve <some-symbol-in-your-repo>   → { "ok": true, "hits": [ … ] }
/cm-impact   <some-file-in-your-repo>    → { "ok": true, "files": [ … ] }
/cm-stats                                 → { "events": ≥3, "saved_percent": … }
```

**Any MCP host** — ask the agent: *"Where is `<some-symbol>` defined?"* If the plugin is wired correctly the agent calls `cm_resolve` directly (instead of grepping), returns the answer in milliseconds, and the ledger records a new event you can inspect with `cm stats`.

**From the terminal** (manual install or sanity check):

```bash
npx -y code-map sync
npx -y code-map resolve <some-symbol>
npx -y code-map impact <some-file>
npx -y code-map stats
```

Still want deeper assurance?

```bash
cd .code-map-plugin
npm test                           # 9 unit tests
npm run benchmark                  # fixture benchmark vs naive baseline
node scripts/benchmark-self.js     # benchmark against the plugin's own repo
```

The self benchmark should report `saved_percent ≥ 0.98`, `locate_hit_rate = 1.0`, `impact_recall = 1.0`.

---

## How it works after install

You do **not** call Code Map explicitly. The agent does, because:

1. **Skills auto-activate on intent.** Each skill ships a YAML `description` that names the triggers (for example, `using-code-map` activates whenever the user asks to locate, navigate, or edit code). Whenever the agent sees a matching intent, the skill loads and tells the agent to prefer `cm_*` tools.
2. **Routing is a strict preference, not a suggestion.** The `using-code-map` skill encodes the rule: try `cm_resolve` first, fall back to `cm_search` only on miss, call `cm_impact` before any edit, and only open a full file when resolver confidence is low. Broad repo reads (`grep`, `ls -R`, reading whole files to guess) are explicit anti-patterns in the skill.
3. **The index is always fresh.** The `SessionStart` hook runs `cm sync` at the top of every session, so the resolver and impact graph reflect the latest commits without the agent asking. After edits, `updating-code-map` nudges the agent to run `cm sync` before the next lookup.
4. **Savings are self-reported.** Every tool call appends to `.code-map/sessions/<id>.jsonl`. Ask the agent "how much did we save?" and the `measuring-context-savings` skill answers with `cm stats` - no custom instrumentation required.

The net effect: after one install, your agent does a cheaper, more accurate thing by default. You can still invoke `cm` manually from the terminal, but you rarely need to.

---

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

---

## Tools (what your agent gets)

| Tool | Returns |
|---|---|
| `cm_resolve` | Exact file/symbol/route/test hit with reason and confidence |
| `cm_search` | Ranked summaries from a BM25-lite index over key tokens |
| `cm_neighbors` | Direct graph neighbors of a node |
| `cm_impact` | Ranked file set likely affected by editing the target |
| `cm_explain` | Composed trace - which layer, which candidates, which decision |
| `cm_sync` | Incremental index refresh |
| `cm_stats` | Per-session `raw_candidate_tokens`, `delivered_tokens`, `saved_percent` |

## Skills (how the agent uses them)

Three short skills tell the agent when and how to reach for the tools:

- [`skills/using-code-map`](skills/using-code-map/SKILL.md) - routing rules and anti-patterns
- [`skills/updating-code-map`](skills/updating-code-map/SKILL.md) - when to re-sync, when to add an `@cm` anchor
- [`skills/measuring-context-savings`](skills/measuring-context-savings/SKILL.md) - reading and reporting savings

Skills are auto-loaded by the Claude Code harness from the plugin's `skills/` directory (declared in `.claude-plugin/plugin.json`). You don't register them by hand.

---

## Anchors (optional but cheap)

```js
// @cm-file domain=auth exports=login,refreshSession routes=POST /login,POST /refresh tests=tests/auth_login.test.js
// @cm id=auth.login role=entry involves=UserRepo,PasswordHasher,JwtService affects=auth.routes,session.refresh
```

Anchors stay short (1-3 lines max). Detail goes in the index. `updating-code-map` tells the agent when to add one.

---

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
