// @cm-file domain=core/api exports=cm_resolve,cm_search,cm_neighbors,cm_impact,cm_sync,cm_stats,cm_explain role=public-tool-surface
const { syncIndex, loadIndex } = require("./indexer");
const { resolve } = require("./resolver");
const { search } = require("./search");
const { neighbors } = require("./neighbors");
const { impact } = require("./impact");
const { explain } = require("./explain");
const { recordEvent, sessionSummary } = require("./stats");

function withRecording(name, fn) {
  return function (input, opts = {}) {
    const t0 = Date.now();
    const result = fn(input, opts);
    const elapsed = Date.now() - t0;
    if (opts.record !== false) {
      recordEvent(
        {
          tool: name,
          ok: !!result.ok,
          raw_candidate_tokens: result.raw_candidate_tokens || result.candidatesConsidered || 0,
          delivered_tokens: result.delivered_tokens || (result.hits ? result.hits.length : (result.neighbors?.length || result.files?.length || 1)),
          elapsedMs: elapsed,
          notes: result.layer || result.reason || null,
        },
        { root: opts.root, sessionId: opts.sessionId }
      );
    }
    return result;
  };
}

module.exports = {
  cm_resolve: withRecording("cm_resolve", resolve),
  cm_search: withRecording("cm_search", search),
  cm_neighbors: withRecording("cm_neighbors", neighbors),
  cm_impact: withRecording("cm_impact", impact),
  cm_explain: withRecording("cm_explain", explain),
  cm_sync: syncIndex,
  cm_stats: sessionSummary,
  loadIndex,
};
