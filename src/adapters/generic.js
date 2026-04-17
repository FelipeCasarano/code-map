// @cm-file domain=adapters/generic exports=handle,toolDescriptors role=json-rpc-adapter
// Generic stdio adapter: any agent that can spawn a process and exchange JSON over stdin/stdout
// can call the cm tools through this thin shim. Intentionally framework-agnostic.
const cm = require("../core");

const toolDescriptors = [
  {
    name: "cm_resolve",
    description: "Deterministic locator. Returns ranked file/symbol/route/test hits for an exact or partial query.",
    parameters: { query: "string", limit: "number?", root: "string?" },
  },
  {
    name: "cm_search",
    description: "Hybrid lexical search over the indexed summaries. Use when cm_resolve returns no hits.",
    parameters: { query: "string", limit: "number?", root: "string?" },
  },
  {
    name: "cm_neighbors",
    description: "Graph neighbors of a file/symbol. Direction can be in, out, or both.",
    parameters: { target: "string", direction: "string?", types: "string[]?", limit: "number?" },
  },
  {
    name: "cm_impact",
    description: "Weighted impact set: which modules are likely to be affected if you edit `target`.",
    parameters: { target: "string", depth: "number?", limit: "number?" },
  },
  {
    name: "cm_explain",
    description: "Trace which layer (resolve/search/graph) answered a query and why. Useful for debugging routing.",
    parameters: { query: "string" },
  },
  {
    name: "cm_sync",
    description: "Refresh the local index. Incremental by default; pass force:true to rebuild.",
    parameters: { root: "string?", force: "boolean?" },
  },
  {
    name: "cm_stats",
    description: "Per-session token-savings summary recorded by the plugin.",
    parameters: { sessionId: "string?" },
  },
];

// @cm id=handle role=entry involves=cm.* affects=adapters/claude-code,adapters/codex
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
  // Minimal stdio loop: one JSON request per line, one JSON response per line.
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
