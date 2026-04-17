// @cm-file domain=core/neighbors exports=neighbors role=graph-neighbor-query
const { loadIndex } = require("./indexer");
const { resolve } = require("./resolver");

function pickNodeId(graph, target) {
  // Accept either a graph nodeId already, a relative path (file::), or a symbol name.
  if (graph.nodes.has(target)) return target;
  if (graph.nodes.has(`file::${target}`)) return `file::${target}`;
  // Search for the first matching symbol or route literal.
  for (const id of graph.nodes.keys()) {
    if (id.endsWith(`::${target}`) || id.endsWith(`#${target}`)) return id;
  }
  return null;
}

// @cm id=neighbors role=entry involves=Graph,resolver affects=cm_neighbors.cli,cm_impact
function neighbors(target, opts = {}) {
  const t0 = Date.now();
  const ctx = opts._ctx || loadIndex(opts.root);
  if (!ctx.index) return { ok: false, reason: "no-index", neighbors: [], elapsedMs: 0 };

  let id = pickNodeId(ctx.graph, target);
  if (!id) {
    const r = resolve(target, { _ctx: ctx, limit: 1 });
    if (r.ok) {
      const top = r.hits[0];
      id =
        pickNodeId(ctx.graph, top.rel) ||
        pickNodeId(ctx.graph, `${top.rel}#${top.name}`) ||
        pickNodeId(ctx.graph, top.name);
    }
  }
  if (!id) {
    return { ok: false, reason: "node-not-found", target, neighbors: [], elapsedMs: Date.now() - t0 };
  }

  const result = ctx.graph.neighbors(id, {
    direction: opts.direction || "both",
    types: opts.types || null,
    limit: opts.limit || 25,
  });

  return {
    ok: true,
    target,
    nodeId: id,
    neighbors: result,
    elapsedMs: Date.now() - t0,
  };
}

module.exports = { neighbors, pickNodeId };
