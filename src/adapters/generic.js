// @cm-file domain=adapters/generic exports=handle,toolDescriptors role=json-rpc-adapter
// Generic stdio adapter: any agent that can spawn a process and exchange JSON over stdin/stdout
// can call the cm tools through this thin shim. The tool descriptors here are also surfaced by
// the MCP server (src/mcp/server.js) via tools/list, so they follow the MCP input-schema shape
// (JSON Schema) rather than an ad-hoc one.
const cm = require("../core");

const toolDescriptors = [
  {
    name: "cm_resolve",
    description:
      "Deterministic locator: returns ranked file/symbol/route/test hits for an exact or partial query. Prefer this over grep or broad file reads.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "File name, basename, symbol, or route literal to locate." },
        limit: { type: "number", description: "Max hits to return. Default 8." },
        root: { type: "string", description: "Project root (defaults to current working directory)." },
      },
      required: ["query"],
    },
  },
  {
    name: "cm_search",
    description:
      "Hybrid lexical (BM25-lite) search over indexed summaries and key tokens. Use when cm_resolve returns no hit.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text query." },
        limit: { type: "number", description: "Max results. Default 10." },
        root: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "cm_neighbors",
    description:
      "Graph neighbors of a file, symbol, or route. Direction can be in, out, or both.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "File path, symbol name, or graph node id." },
        direction: { type: "string", enum: ["in", "out", "both"], description: "Edge direction. Default both." },
        types: { type: "array", items: { type: "string" }, description: "Restrict to edge types (imports, calls, tested_by, ...)." },
        limit: { type: "number" },
      },
      required: ["target"],
    },
  },
  {
    name: "cm_impact",
    description:
      "Weighted impact set: which modules are likely affected if you edit `target`. Call this BEFORE editing a shared utility.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "File path or symbol that is about to be edited." },
        depth: { type: "number", description: "Max BFS depth. Default 2." },
        limit: { type: "number", description: "Max files to return. Default 30." },
      },
      required: ["target"],
    },
  },
  {
    name: "cm_explain",
    description:
      "Trace which retrieval layer (resolve/search/graph) answered a query and why. Useful for debugging routing.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "cm_sync",
    description: "Refresh the local index. Incremental by default; pass force:true to rebuild from scratch.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        force: { type: "boolean", description: "Ignore cached parser output and rebuild." },
      },
    },
  },
  {
    name: "cm_stats",
    description: "Per-session token-savings summary recorded by the plugin ledger.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string", description: "Defaults to the current CM_SESSION or 'default'." } },
    },
  },
];

// @cm id=handle role=entry involves=cm.* affects=mcp/server
function handle(req) {
  const { tool, params = {} } = req || {};
  switch (tool) {
    case "cm_resolve": return cm.cm_resolve(params.query, params);
    case "cm_search": return cm.cm_search(params.query, params);
    case "cm_neighbors": return cm.cm_neighbors(params.target, params);
    case "cm_impact": return cm.cm_impact(params.target, params);
    case "cm_explain": return cm.cm_explain(params.query, params);
    case "cm_sync": return cm.cm_sync(params);
    case "cm_stats": return cm.cm_stats(params);
    case "tools/list": return { tools: toolDescriptors };
    default: return { ok: false, error: "unknown tool: " + tool };
  }
}

if (require.main === module) {
  const readline = require("readline");
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let req, res;
    try { req = JSON.parse(line); } catch (e) {
      process.stdout.write(JSON.stringify({ ok: false, error: "bad-json: " + e.message }) + "\n");
      return;
    }
    try { res = handle(req); } catch (e) {
      res = { ok: false, error: e.message };
    }
    process.stdout.write(JSON.stringify(res) + "\n");
  });
}

module.exports = { handle, toolDescriptors };
