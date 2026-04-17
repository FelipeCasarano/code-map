// @cm-file domain=core/explain exports=explain role=human-readable-trace
const { loadIndex } = require("./indexer");
const { resolve } = require("./resolver");
const { search } = require("./search");
const { neighbors } = require("./neighbors");
const { impact } = require("./impact");

// @cm id=explain role=entry involves=resolve,search,neighbors,impact affects=cm_explain.cli
function explain(query, opts = {}) {
  const ctx = opts._ctx || loadIndex(opts.root);
  if (!ctx.index) return { ok: false, reason: "no-index" };

  const r = resolve(query, { _ctx: ctx, limit: 5 });
  const s = search(query, { _ctx: ctx, limit: 5 });
  const trace = {
    query,
    resolver: {
      ok: r.ok,
      layer: r.layer,
      candidatesConsidered: r.candidatesConsidered,
      hits: r.hits,
    },
    search: {
      ok: s.ok,
      candidatesConsidered: s.candidatesConsidered,
      hits: s.hits,
    },
  };

  if (r.ok) {
    const top = r.hits[0];
    const n = neighbors(top.rel, { _ctx: ctx, limit: 8 });
    const i = impact(top.rel, { _ctx: ctx, limit: 8 });
    trace.neighbors = n.neighbors;
    trace.impact = i.files;
    trace.decision = `Resolver layer=${r.layer} matched ${top.rel}; neighbors and impact derived from cached graph (no new file reads).`;
  } else if (s.ok) {
    trace.decision = `Resolver missed; lexical search returned ${s.hits.length} candidates from ${s.candidatesConsidered} summaries.`;
  } else {
    trace.decision = "Both resolver and search returned no hits. Recommend full-text fallback.";
  }
  return trace;
}

module.exports = { explain };
