# Installation

Code Map has zero runtime dependencies. Node 18+ is the only prerequisite.

## Install from GitHub (existing project)

```bash
# from your repo root
git clone https://github.com/FelipeCasarano/code-map .code-map-plugin
node .code-map-plugin/src/cli/index.js sync     # builds .code-map/ in your repo
```

Optionally add the CLI to your PATH:

```bash
npm install --no-save ./.code-map-plugin
# now `cm sync`, `cm resolve ...`, etc. are on PATH
```

## Install in a brand-new project

```bash
mkdir my-project && cd my-project
git clone https://github.com/FelipeCasarano/code-map .code-map-plugin
node .code-map-plugin/src/cli/index.js sync
```

## Wire it into Claude Code

Copy `configs/claude-code.json` into your `.claude/plugins/code-map/plugin.json`, or point your `~/.claude/settings.json` at it:

```json
{
  "plugins": {
    "code-map": {
      "path": "./.code-map-plugin",
      "config": "./.code-map-plugin/configs/claude-code.json"
    }
  }
}
```

The skills under `skills/` are picked up automatically by the harness.

## Wire it into Codex / Codex-CLI

```bash
codex plugin add ./.code-map-plugin --config configs/codex.json
```

## Wire it into any MCP host

`configs/mcp.json` exposes the plugin as a stdio MCP server:

```json
{
  "mcpServers": {
    "code-map": {
      "command": "node",
      "args": [".code-map-plugin/src/mcp/server.js"]
    }
  }
}
```

## Project-local install (no clone)

```bash
npm install --save-dev github:FelipeCasarano/code-map
npx cm sync
```

## Verifying

```bash
node src/cli/index.js sync         # builds index
node src/cli/index.js resolve foo  # resolver test
node src/cli/index.js stats        # session ledger
npm test                           # 9 unit tests
npm run benchmark                  # fixture benchmark
node scripts/benchmark-self.js     # benchmark against this plugin's own repo
```
