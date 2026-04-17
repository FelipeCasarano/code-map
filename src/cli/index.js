#!/usr/bin/env node
// @cm-file domain=cli/entry exports=main role=command-router affects=README.usage
const path = require("path");
const fs = require("fs");
const cm = require("../core");
const pkg = require("../../package.json");

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json" || a === "--quiet" || a === "--silent") args.flags[a.replace(/^--/, "")] = true;
    else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) args.flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        args.flags[a.slice(2)] = argv[++i];
      } else args.flags[a.slice(2)] = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function emit(result, flags) {
  if (flags.silent || process.env.CM_SILENT === "1") return;
  if (flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (result == null) return;
  if (typeof result === "string") {
    process.stdout.write(result + "\n");
    return;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

function help() {
  return [
    `code-map v${pkg.version} - Code Map + Context Routing for coding agents.`,
    "",
    "Usage:",
    "  cm sync [--root path] [--force]                 Build/refresh the local index",
    "  cm resolve <query> [--root path] [--limit N]    Deterministic file/symbol/route lookup",
    "  cm search <query> [--limit N]                   Hybrid lexical search over the index",
    "  cm neighbors <target> [--depth N] [--types ..]  Graph neighbors of a node",
    "  cm impact <target> [--depth N] [--limit N]      Weighted impact set",
    "  cm stats [--session id]                         Token-savings summary for the session",
    "  cm explain <query>                              Trace which layer answered and why",
    "  cm help                                         Show this help",
    "",
    "Common flags: --json (machine output), --root <path>, --session <id>",
  ].join("\n");
}

// @cm id=main role=entry involves=cm.* affects=cli
function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cmd = args._[0] || "help";
  const flags = args.flags;
  const opts = {
    root: flags.root ? path.resolve(flags.root) : undefined,
    limit: flags.limit ? parseInt(flags.limit, 10) : undefined,
    depth: flags.depth ? parseInt(flags.depth, 10) : undefined,
    sessionId: flags.session,
    force: !!flags.force,
    types: flags.types ? String(flags.types).split(",") : null,
    direction: flags.direction || "both",
  };
  try {
    switch (cmd) {
      case "sync": {
        const r = cm.cm_sync(opts);
        return emit(r, flags);
      }
      case "resolve": {
        const q = args._.slice(1).join(" ");
        return emit(cm.cm_resolve(q, opts), flags);
      }
      case "search": {
        const q = args._.slice(1).join(" ");
        return emit(cm.cm_search(q, opts), flags);
      }
      case "neighbors": {
        const t = args._.slice(1).join(" ");
        return emit(cm.cm_neighbors(t, opts), flags);
      }
      case "impact": {
        const t = args._.slice(1).join(" ");
        return emit(cm.cm_impact(t, opts), flags);
      }
      case "stats": {
        return emit(cm.cm_stats(opts), flags);
      }
      case "explain": {
        const q = args._.slice(1).join(" ");
        return emit(cm.cm_explain(q, opts), flags);
      }
      case "help":
      case "--help":
      case "-h":
        return emit(help(), flags);
      default:
        process.stderr.write(`Unknown command: ${cmd}\n` + help() + "\n");
        process.exitCode = 1;
    }
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    if (process.env.CM_DEBUG) process.stderr.write(err.stack + "\n");
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { main, parseArgs };
