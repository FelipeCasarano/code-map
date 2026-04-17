// @cm-file domain=mcp/server exports=createServer role=mcp-style-stdio-server
// Tiny MCP-flavoured server: exposes the cm tools via JSON-RPC 2.0 over stdin/stdout.
// Implements the bare minimum (initialize, tools/list, tools/call) so a real MCP host
// can attach without pulling the full @modelcontextprotocol/sdk into the dependency tree.
const readline = require("readline");
const { handle, toolDescriptors } = require("../adapters/generic");

function send(res) {
  process.stdout.write(JSON.stringify(res) + "\n");
}

function rpc(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function rpcErr(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function createServer() {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let req;
    try { req = JSON.parse(line); } catch (e) {
      return send(rpcErr(null, -32700, "parse error: " + e.message));
    }
    const { id, method, params } = req;
    try {
      switch (method) {
        case "initialize":
          return send(rpc(id, {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "code-map", version: require("../../package.json").version },
            capabilities: { tools: {} },
          }));
        case "tools/list":
          return send(rpc(id, { tools: toolDescriptors }));
        case "tools/call": {
          const { name, arguments: args = {} } = params || {};
          const result = handle({ tool: name, params: args });
          return send(rpc(id, { content: [{ type: "text", text: JSON.stringify(result) }] }));
        }
        case "ping":
          return send(rpc(id, {}));
        default:
          return send(rpcErr(id, -32601, "method not found: " + method));
      }
    } catch (e) {
      return send(rpcErr(id, -32603, e.message));
    }
  });
}

if (require.main === module) createServer();

module.exports = { createServer };
