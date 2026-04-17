// @cm-file domain=core/resolver exports=resolve role=deterministic-locator
// Layer 1 of the memory: exact path / suffix / symbol / route lookup before any search.
const path = require("path");
const { loadIndex } = require("./indexer");

function basename(rel) {
  return rel.split("/").pop();
}

// @cm id=resolve role=entry involves=loadIndex,symbols,aliases affects=cm_resolve.cli,cm_search.fallback
function resolve(query, opts = {}) {
  const t0 = Date.now();
  const { root, index, symbols, aliases } = opts._ctx || loadIndex(opts.root);
  if (!index) return { ok: false, reason: "no-index", hits: [], elapsedMs: 0 };

  const q = String(query || "").trim();
  if (!q) return { ok: false, reason: "empty-query", hits: [], elapsedMs: 0 };

  const ql = q.toLowerCase();
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

  // 3) symbol exact match via alias map
  if (aliases.has(ql)) {
    for (const hit of aliases.get(ql)) {
      push({ kind: hit.kind || "symbol", rel: hit.rel, line: hit.line, score: 0.92, reason: "symbol-exact", name: q });
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

  // 6) fuzzy basename: partial inclusion
  if (hits.length === 0) {
    for (const f of index.files) {
      const base = basename(f.rel).toLowerCase();
      if (base.includes(ql)) {
        const ratio = ql.length / base.length;
        push({ kind: "file", rel: f.rel, line: 1, score: 0.55 + ratio * 0.2, reason: "fuzzy-basename", name: basename(f.rel) });
      }
    }
  }

  // 7) symbol contains
  if (hits.length === 0) {
    for (const s of symbols) {
      if (s.name && s.name.toLowerCase().includes(ql)) {
        push({ kind: s.kind || "symbol", rel: s.rel, line: s.line, score: 0.5, reason: "symbol-contains", name: s.name });
      }
    }
  }

  hits.sort((a, b) => b.score - a.score);
  const limit = opts.limit || 8;
  const out = hits.slice(0, limit);

  return {
    ok: out.length > 0,
    query: q,
    hits: out,
    layer: out[0]?.reason || null,
    elapsedMs: Date.now() - t0,
    candidatesConsidered: index.files.length + symbols.length,
  };
}

module.exports = { resolve };
