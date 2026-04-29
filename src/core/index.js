// @cm-file domain=core/api exports=cm_resolve,cm_search,cm_neighbors,cm_impact,cm_sync,cm_stats,cm_explain role=public-tool-surface
const { syncIndex, loadIndex, isIndexStale } = require("./indexer");
const { resolve } = require("./resolver");
const { search } = require("./search");
const { neighbors } = require("./neighbors");
const { impact } = require("./impact");
const { explain } = require("./explain");
const { recordEvent, sessionSummary } = require("./stats");
const { estimateTokens } = require("./tokens");

function flag(name) {
  return process.env["CM_" + name.toUpperCase()] === "1";
}

// Honest delivered-token count: serialize the payload an agent would receive and
// estimate tokens over its bytes. Falls back to legacy heuristic when flag off.
function honestDelivered(result) {
  if (!result) return 0;
  // Slimmed payload version is computed by the slimming layer, when enabled.
  if (result._slimmed_payload) return estimateTokens(JSON.stringify(result._slimmed_payload));
  // Generic JSON size fallback: serialize, ignoring noisy fields.
  try {
    const clone = JSON.parse(JSON.stringify(result));
    delete clone.elapsedMs;
    delete clone.candidatesConsidered;
    delete clone.raw_candidate_tokens;
    delete clone.delivered_tokens;
    delete clone._slimmed_payload;
    return estimateTokens(JSON.stringify(clone));
  } catch {
    return 0;
  }
}

// Honest raw budget: tokens of all files the index has scanned. Cached on the index.
function honestRaw(opts) {
  try {
    const idx = loadIndex(opts && opts.root);
    if (idx && idx.index && typeof idx.index.totalTokens === "number") return idx.index.totalTokens;
  } catch {}
  return 0;
}

function withRecording(name, fn) {
  return function (input, opts = {}) {
    const t0 = Date.now();
    const result = fn(input, opts) || {};
    const elapsed = Date.now() - t0;
    // Stale warning: if the repo fingerprint shifted, mark result and degrade confidence.
    if (flag("stale_warn") && opts && opts.root) {
      try {
        const s = isIndexStale(opts.root);
        if (s && s.stale) {
          result.stale = true;
          result.stale_reason = s.reason;
          if (typeof result.confidence === "number") result.confidence = Math.min(result.confidence, 0.4);
          else result.confidence = 0.4;
        }
      } catch {}
    }
    if (opts.record !== false) {
      let raw, delivered;
      if (flag("honest_accounting")) {
        raw = honestRaw(opts);
        delivered = honestDelivered(result);
      } else {
        raw = result.raw_candidate_tokens || result.candidatesConsidered || 0;
        delivered = result.delivered_tokens || (result.hits ? result.hits.length : (result.neighbors?.length || result.files?.length || 1));
      }
      recordEvent(
        {
          tool: name,
          ok: !!result.ok,
          raw_candidate_tokens: raw,
          delivered_tokens: delivered,
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
