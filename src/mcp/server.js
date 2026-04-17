#!/usr/bin/env node
// @cm-file domain=mcp/server exports=createServer role=mcp-style-stdio-server
// Minimal MCP stdio server: exposes the cm tools via JSON-RPC 2.0 on stdin/stdout.
// Implements enough of the MCP surface (initialize, notifications/initialized, tools/list,
// tools/call, ping, shutdown, resources/list, prompts/list, logging/setLevel) that strict
// clients (Claude Code, Cursor, Continue, Zed, Antigravity) don't reject the handshake.
const readline = require("readline");
const { handle, toolDescriptors } = require("../adapters/generic");

// Protocol versions we understand. If the client asks for one of these we echo it back;
// otherwise we reply with our newest. This mirrors what the reference MCP SDK does.
const KNOWN_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const DEFAULT_VERSION = "2025-06-18";

function dbg(...a) {
  if (process.env.CM_DEBUG) process.stderr.write("[cm-mcp] " + a.map(String).join(" ") + "\n");
}

function send(res) {
  try {
    process.stdout.write(JSON.stringify(res) + "\n");
  } catch (e) {
    dbg("send failed:", e.message);
  }
}

function rpc(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function rpcErr(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function pickVersion(requested) {
  if (requested && KNOWN_VERSIONS.has(requested)) return requested;
  return DEFAULT_VERSION;
}

function createServer() {
  const pkg = require("../../package.json");
  const rl = readline.createInterface({ input: process.stdin });

  rl.on("line", (line) => {
    if (!line.trim()) return;
    let req;
    try { req = JSON.parse(line); } catch (e) {
      dbg("parse error:", e.message, "line=", line);
      return send(rpcErr(null, -32700, "parse error: " + e.message));
    }
    const { id, method, params } = req || {};
    const isNotification = id === undefined || id === null;

    if (!method || typeof method !== "string") {
      if (!isNotification) send(rpcErr(id, -32600, "invalid request: missing method"));
      return;
    }

    dbg("→", method, isNotification ? "(notif)" : `id=${id}`);

    try {
      switch (method) {
        case "initialize": {
          const clientVersion = params && params.protocolVersion;
          const protocolVersion = pickVersion(clientVersion);
          dbg("init clientVersion=", clientVersion, "→", protocolVersion);
          return send(rpc(id, {
            protocolVersion,
            serverInfo: { name: "code-map", version: pkg.version },
            capabilities: {
              tools: { listChanged: false },
              resources: { listChanged: false, subscribe: false },
              prompts: { listChanged: false },
              logging: {},
            },
          }));
        }

        case "notifications/initialized":
        case "initialized":
          return;

        case "tools/list":
          return send(rpc(id, { tools: toolDescriptors }));

        case "tools/call": {
          const name = params && params.name;
          const args = (params && params.arguments) || {};
          if (!name) {
            return send(rpcErr(id, -32602, "invalid params: missing tool name"));
          }
          const result = handle({ tool: name, params: args });
          const isError = result && result.ok === false;
          return send(rpc(id, {
            content: [{ type: "text", text: JSON.stringify(result) }],
            isError,
          }));
        }

        case "resources/list":
          return send(rpc(id, { resources: [] }));

        case "resources/templates/list":
          return send(rpc(id, { resourceTemplates: [] }));

        case "prompts/list":
          return send(rpc(id, { prompts: [] }));

        case "logging/setLevel":
          return send(rpc(id, {}));

        case "ping":
          return send(rpc(id, {}));

        case "shutdown":
          send(rpc(id, {}));
          return process.exit(0);

        case "notifications/cancelled":
        case "notifications/progress":
          return;

        default:
          if (isNotification) return;
          return send(rpcErr(id, -32601, "method not found: " + method));
      }
    } catch (e) {
      dbg("handler threw:", method, e.message);
      if (isNotification) return;
      return send(rpcErr(id, -32603, e.message));
    }
  });

  // Keep the process alive on EOF from stdin (some hosts close/reopen pipes).
  rl.on("close", () => {
    dbg("stdin closed");
  });

  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
}

if (require.main === module) createServer();

module.exports = { createServer };
