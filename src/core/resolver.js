// @cm-file domain=core/resolver exports=resolve role=deterministic-locator
// Layer 1 of the memory: exact path / suffix / symbol / route lookup before any search.
const path = require("path");
const { loadIndex } = require("./indexer");

function basename(rel) {
  return rel.split("/").pop();
}

const TEST_PATH_RE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/i;
const TEST_QUERY_RE = /\b(test|spec|fixture)\b/i;

function isTestRel(rel) {
  return TEST_PATH_RE.test(rel);
}

// @cm id=resolve role=entry involves=loadIndex,symbols,aliases affects=cm_resolve.cli,cm_search.fallback
function resolve(query, opts = {}) {
  const t0 = Date.now();
  const { root, index, symbols, aliases } = opts._ctx || loadIndex(opts.root);
  if (!index) return { ok: false, reason: "no-index", hits: [], elapsedMs: 0 };

  const q = String(query || "").trim();
  if (!q) return { ok: false, reason: "empty-query", hits: [], elapsedMs: 0 };

  const ql = q.toLowerCase();
  const hasDot = q.includes(".") && !q.startsWith(".") && !q.endsWith(".");
  const queryHasTestIntent = TEST_QUERY_RE.test(q);
  const hits = [];
  const seen = new Set();
  const push = (h) => {
    const key = `${h.kind}:${h.rel}:${h.line || 0}:${h.name || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(h);
  };

  // 1) exact relative path
  for (const f of index.files) {
    if (f.rel === q) {
      push({ kind: "file", rel: f.rel, line: 1, score: 1.0, reason: "exact-path", name: basename(f.rel) });
    }
  }

  // 2) exact basename match (case-sensitive then insensitive)
  for (const f of index.files) {
    const base = basename(f.rel);
    if (base === q) {
      push({ kind: "file", rel: f.rel, line: 1, score: 0.95, reason: "exact-basename", name: base });
    } else if (base.toLowerCase() === ql) {
      push({ kind: "file", rel: f.rel, line: 1, score: 0.9, reason: "case-insensitive-basename", name: base });
    }
  }

  // 3) symbol exact match via alias map.
  // A2: dotted queries match the qualifiedName key first; then fall back to last-segment.
  // A3: penalize hits whose file is a test when the query has no test intent.
  if (aliases.has(ql)) {
    for (const hit of aliases.get(ql)) {
      let score = 0.92;
      if (!queryHasTestIntent && isTestRel(hit.rel)) score *= 0.7;
      push({ kind: hit.kind || "symbol", rel: hit.rel, line: hit.line, score, reason: "symbol-exact", name: q });
    }
  }
  // A2: if query is dotted (e.g., "app.handle") and exact match missed, try last segment.
  if (hasDot && hits.length === 0) {
    const lastSeg = ql.split(".").pop();
    if (aliases.has(lastSeg)) {
      for (const hit of aliases.get(lastSeg)) {
        // Boost when hit's qualifiedName matches the original dotted query.
        const exactQualified = hit.qualifiedName && hit.qualifiedName.toLowerCase() === ql;
        let score = exactQualified ? 0.94 : 0.78;
        if (!queryHasTestIntent && isTestRel(hit.rel)) score *= 0.7;
        push({ kind: hit.kind || "symbol", rel: hit.rel, line: hit.line, score, reason: exactQualified ? "symbol-exact-qualified" : "symbol-last-segment", name: q });
      }
    }
  }

  // 4) route literal "GET /foo" or "/foo"
  if (q.includes("/")) {
    const parts = q.split(/\s+/);
    const pathPart = parts.length === 2 ? parts[1] : parts[0];
    const methodPart = parts.length === 2 ? parts[0].toUpperCase() : null;
    for (const s of symbols) {
      if (s.kind !== "route") continue;
      const [m, p] = s.name.split(/\s+/);
      if (p === pathPart && (!methodPart || m === methodPart)) {
        push({ kind: "route", rel: s.rel, line: s.line, score: 0.93, reason: "route-exact", name: s.name });
      }
    }
  }

  // 5) suffix path match: "auth/login.js"
  if (q.includes("/") && hits.length === 0) {
    for (const f of index.files) {
      if (f.rel.endsWith("/" + q) || f.rel.endsWith(q)) {
        push({ kind: "file", rel: f.rel, line: 1, score: 0.85, reason: "suffix-path", name: basename(f.rel) });
      }
    }
  }

  // 6) fuzzy basename: partial inclusion.
  // A4: skip when query is dotted (it's a symbol reference, not a path); also penalize tests.
  if (hits.length === 0 && !hasDot) {
    for (const f of index.files) {
      const base = basename(f.rel).toLowerCase();
      if (base.includes(ql)) {
        const ratio = ql.length / base.length;
        let score = 0.55 + ratio * 0.2;
        if (!queryHasTestIntent && isTestRel(f.rel)) score *= 0.7;
        push({ kind: "file", rel: f.rel, line: 1, score, reason: "fuzzy-basename", name: basename(f.rel) });
      }
    }
  }

  // 7) symbol contains
  if (hits.length === 0) {
    const lookup = hasDot ? ql.split(".").pop() : ql;
    for (const s of symbols) {
      if (s.name && s.name.toLowerCase().includes(lookup)) {
        let score = 0.5;
        if (!queryHasTestIntent && isTestRel(s.rel)) score *= 0.7;
        push({ kind: s.kind || "symbol", rel: s.rel, line: s.line, score, reason: "symbol-contains", name: s.name });
      }
    }
  }

  hits.sort((a, b) => b.score - a.score);
  const slim = process.env.CM_PAYLOAD_SLIM === "1";
  const limit = opts.limit || (slim ? 3 : 8);
  const out = hits.slice(0, limit);

  // A6: low-confidence signal. Anything below this score is weak.
  const topScore = out[0]?.score || 0;
  const lowConfidenceLayers = new Set(["symbol-contains", "fuzzy-basename"]);
  const lowConfidence = !out.length || topScore < 0.7 || lowConfidenceLayers.has(out[0]?.reason);

  if (slim) {
    const payload = {
      ok: out.length > 0,
      query: q,
      hits: out.map((h) => ({ rel: h.rel, score: h.score })),
      layer: out[0]?.reason || null,
      elapsedMs: Date.now() - t0,
    };
    if (lowConfidence) {
      payload.confidence = Math.min(0.5, topScore || 0.3);
      payload.suggest_fallback = "rg";
    } else {
      payload.confidence = Math.min(1, topScore);
    }
    return payload;
  }
  return {
    ok: out.length > 0,
    query: q,
    hits: out,
    layer: out[0]?.reason || null,
    elapsedMs: Date.now() - t0,
    candidatesConsidered: index.files.length + symbols.length,
    confidence: lowConfidence ? Math.min(0.5, topScore || 0.3) : Math.min(1, topScore),
    suggest_fallback: lowConfidence ? "rg" : undefined,
  };
}

module.exports = { resolve };
