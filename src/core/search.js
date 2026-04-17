// @cm-file domain=core/search exports=search role=hybrid-lexical-search
// BM25-lite over keyTokens + path tokens, with anchor + role boosts.
const { loadIndex } = require("./indexer");

const STOP = new Set(["the", "and", "for", "with", "from", "this", "that", "into", "are", "use", "get", "set"]);

function tokenize(q) {
  return Array.from(
    new Set(
      String(q || "")
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((t) => t && t.length >= 2 && !STOP.has(t))
    )
  );
}

function pathTokens(rel) {
  return rel.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function buildPostings(summaries) {
  const df = new Map();
  const docs = summaries.map((s) => {
    const ptoks = pathTokens(s.rel);
    const stoks = (s.keyTokens || []).map((t) => t.toLowerCase());
    const sym = (s.headlineSymbols || []).flatMap((h) => tokenize(h.split(":").pop()));
    const route = (s.routes || []).flatMap((r) => tokenize(r));
    const allTokens = [...ptoks, ...stoks, ...sym, ...route];
    const tf = new Map();
    for (const tok of allTokens) tf.set(tok, (tf.get(tok) || 0) + 1);
    for (const tok of tf.keys()) df.set(tok, (df.get(tok) || 0) + 1);
    return { rel: s.rel, role: s.role, tf, length: allTokens.length, anchored: !!s.anchors };
  });
  return { docs, df, N: docs.length };
}

const K1 = 1.3;
const B = 0.7;

// @cm id=search role=ranking involves=loadIndex,buildPostings affects=cm_search.cli,baseline-comparison
function search(query, opts = {}) {
  const t0 = Date.now();
  const ctx = opts._ctx || loadIndex(opts.root);
  if (!ctx.index) return { ok: false, reason: "no-index", hits: [], elapsedMs: 0 };
  const tokens = tokenize(query);
  if (!tokens.length) return { ok: false, reason: "empty-query", hits: [], elapsedMs: 0 };

  const { docs, df, N } = buildPostings(ctx.summaries);
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, docs.length);
  const scored = [];
  for (const d of docs) {
    let score = 0;
    let matched = 0;
    for (const t of tokens) {
      const tf = d.tf.get(t);
      if (!tf) continue;
      matched++;
      const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
      const norm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (d.length / avgLen)));
      score += idf * norm;
    }
    if (matched === 0) continue;
    if (d.anchored) score *= 1.15;
    if (d.role === "test" && !tokens.some((t) => /test|spec/.test(t))) score *= 0.85;
    if (d.role === "route" && tokens.some((t) => /route|api|endpoint|http/.test(t))) score *= 1.1;
    scored.push({ rel: d.rel, score: Number(score.toFixed(4)), matched, role: d.role });
  }
  scored.sort((a, b) => b.score - a.score);
  const limit = opts.limit || 12;
  return {
    ok: scored.length > 0,
    query,
    hits: scored.slice(0, limit),
    elapsedMs: Date.now() - t0,
    candidatesConsidered: docs.length,
  };
}

module.exports = { search, tokenize };
