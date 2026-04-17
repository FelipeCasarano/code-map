// @cm-file domain=core/impact exports=impact role=weighted-bfs-impact-set
const { loadIndex } = require("./indexer");
const { resolve } = require("./resolver");
const { pickNodeId } = require("./neighbors");

// @cm id=impact role=entry involves=Graph,resolver affects=cm_impact.cli,benchmark.impact_recall
function impact(target, opts = {}) {
  const t0 = Date.now();
  const ctx = opts._ctx || loadIndex(opts.root);
  if (!ctx.index) return { ok: false, reason: "no-index", impact: [], elapsedMs: 0 };

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
  if (!id) return { ok: false, reason: "node-not-found", target, impact: [], elapsedMs: Date.now() - t0 };

  const fileLimit = opts.limit || 30;
  // Pull a wider raw set so cross-file results survive the file projection step.
  const rawLimit = Math.max(fileLimit * 6, 60);
  const set = ctx.graph.impact(id, {
    depth: opts.depth || 2,
    limit: rawLimit,
    decay: opts.decay || 0.55,
  });

  // Project graph nodes back to file paths for caller convenience.
  const files = [];
  const seenFiles = new Set();
  for (const item of set) {
    const node = item.node;
    let rel = null;
    if (node.type === "file") rel = node.key;
    else if (node.file) rel = node.file;
    if (rel && !seenFiles.has(rel)) {
      seenFiles.add(rel);
      files.push({ rel, score: item.score, via: item.path, sourceType: node.type, sourceKey: node.key });
      if (files.length >= fileLimit) break;
    }
  }

  return {
    ok: true,
    target,
    nodeId: id,
    impact: set,
    files,
    elapsedMs: Date.now() - t0,
  };
}

module.exports = { impact };
