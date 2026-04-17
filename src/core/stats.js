// @cm-file domain=core/stats exports=recordEvent,sessionSummary,readBenchmark,writeBenchmark role=token-accounting-ledger
const path = require("path");
const fs = require("fs");
const { Store } = require("./db");
const { repoRoot } = require("./paths");
const { estimateTokens } = require("./tokens");

function sessionFile(store, sessionId) {
  return path.join(store.dir, "sessions", `${sessionId}.jsonl`);
}

// @cm id=recordEvent role=write involves=Store affects=cm_stats.cli,benchmark
function recordEvent(event, opts = {}) {
  const root = opts.root || repoRoot();
  const store = new Store(root);
  const sessionId = opts.sessionId || process.env.CM_SESSION || "default";
  fs.mkdirSync(path.join(store.dir, "sessions"), { recursive: true });
  const row = {
    ts: Date.now(),
    sessionId,
    tool: event.tool,
    raw_candidate_tokens: event.raw_candidate_tokens || 0,
    delivered_tokens: event.delivered_tokens || 0,
    saved_tokens: Math.max(0, (event.raw_candidate_tokens || 0) - (event.delivered_tokens || 0)),
    elapsedMs: event.elapsedMs || 0,
    ok: !!event.ok,
    notes: event.notes || null,
  };
  fs.appendFileSync(sessionFile(store, sessionId), JSON.stringify(row) + "\n");
  return row;
}

function readSession(root, sessionId) {
  const store = new Store(root);
  const f = sessionFile(store, sessionId);
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function summarize(rows) {
  if (!rows.length) {
    return {
      events: 0,
      raw_candidate_tokens: 0,
      delivered_tokens: 0,
      saved_tokens: 0,
      saved_percent: 0,
      median_latency_ms: 0,
      ok_rate: 0,
    };
  }
  const raw = rows.reduce((s, r) => s + r.raw_candidate_tokens, 0);
  const delivered = rows.reduce((s, r) => s + r.delivered_tokens, 0);
  const lat = rows.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const median = lat[Math.floor(lat.length / 2)] || 0;
  const okRate = rows.filter((r) => r.ok).length / rows.length;
  return {
    events: rows.length,
    raw_candidate_tokens: raw,
    delivered_tokens: delivered,
    saved_tokens: Math.max(0, raw - delivered),
    saved_percent: raw > 0 ? Number(((raw - delivered) / raw).toFixed(4)) : 0,
    median_latency_ms: median,
    ok_rate: Number(okRate.toFixed(4)),
  };
}

function sessionSummary(opts = {}) {
  const root = opts.root || repoRoot();
  const sessionId = opts.sessionId || process.env.CM_SESSION || "default";
  const rows = readSession(root, sessionId);
  return { sessionId, root, summary: summarize(rows), events: rows.length };
}

function readBenchmark(root) {
  const store = new Store(root || repoRoot());
  return store.readJSON("benchmark", null);
}

function writeBenchmark(snapshot, root) {
  const store = new Store(root || repoRoot());
  store.writeJSON("benchmark", snapshot);
}

module.exports = { recordEvent, sessionSummary, readBenchmark, writeBenchmark, estimateTokens, summarize };
