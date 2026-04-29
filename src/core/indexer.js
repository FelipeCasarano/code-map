// @cm-file domain=core/indexer exports=syncIndex,loadIndex role=orchestrate-scan-parse-store affects=cm_resolve,cm_search,cm_neighbors,cm_impact
const fs = require("fs");
const path = require("path");
const { Store } = require("./db");
const { scanRepo } = require("./scanner");
const { parseFile } = require("./parser");
const { buildGraph, Graph } = require("./graph");
const { estimateTokens } = require("./tokens");
const { repoRoot } = require("./paths");

const SCHEMA_VERSION = 2;

function tokenizeForSearch(text) {
  return Array.from(
    new Set(
      (text.toLowerCase().match(/[a-z0-9_]{2,}/g) || []).slice(0, 1500)
    )
  );
}

// @cm id=syncIndex role=orchestration involves=Store,scanRepo,parseFile,buildGraph affects=cm_resolve,cm_search,cm_impact
function syncIndex(opts = {}) {
  const root = opts.root ? path.resolve(opts.root) : repoRoot();
  const store = new Store(root);
  const previous = store.readJSON("index", null);
  const prevByPath = new Map();
  if (previous && previous.files) {
    for (const f of previous.files) prevByPath.set(f.rel, f);
  }

  const t0 = Date.now();
  const found = scanRepo(root, opts);
  const fileRecords = [];
  const symbols = [];
  const summaries = [];
  const aliases = new Map();
  const parsedFiles = [];

  let parsedCount = 0;
  let cachedCount = 0;
  let totalTokens = 0;

  for (const f of found) {
    const prev = prevByPath.get(f.rel);
    let parsed;
    let text;
    if (prev && prev.mtimeMs === f.mtimeMs && prev.size === f.size && !opts.force) {
      // Reuse parser output recorded last sync to keep work incremental.
      parsed = prev._parsed;
      cachedCount++;
    }
    if (!parsed) {
      try {
        text = fs.readFileSync(f.abs, "utf8");
      } catch {
        continue;
      }
      parsed = parseFile(f.rel, text);
      parsed._tokens = estimateTokens(text);
      parsedCount++;
    }
    parsedFiles.push(parsed);

    const tokens = parsed._tokens || prev?._parsed?._tokens || 0;
    totalTokens += tokens;

    const record = {
      rel: f.rel,
      size: f.size,
      mtimeMs: f.mtimeMs,
      role: parsed.role,
      lineCount: parsed.lineCount,
      tokens,
      symbolCount: parsed.symbols.length,
      routeCount: parsed.routes.length,
      testCount: parsed.tests.length,
      anchors: parsed.anchors,
      _parsed: parsed,
    };
    fileRecords.push(record);

    for (const s of parsed.symbols) {
      symbols.push({ rel: f.rel, name: s.name, kind: s.kind, line: s.line, qualifiedName: s.qualifiedName });
      const key = s.name.toLowerCase();
      if (!aliases.has(key)) aliases.set(key, []);
      aliases.get(key).push({ rel: f.rel, line: s.line, kind: s.kind, qualifiedName: s.qualifiedName });
      // Also key by qualifiedName so dotted queries hit directly.
      if (s.qualifiedName) {
        const qk = s.qualifiedName.toLowerCase();
        if (qk !== key) {
          if (!aliases.has(qk)) aliases.set(qk, []);
          aliases.get(qk).push({ rel: f.rel, line: s.line, kind: s.kind, qualifiedName: s.qualifiedName });
        }
      }
    }
    for (const r of parsed.routes) {
      symbols.push({ rel: f.rel, name: `${r.method} ${r.path}`, kind: "route", line: r.line });
    }
    for (const t of parsed.tests) {
      symbols.push({ rel: f.rel, name: t.name, kind: "test", line: t.line });
    }

    const summary = {
      rel: f.rel,
      role: parsed.role,
      tokens,
      keyTokens: parsed.tokens.slice(0, 60),
      anchors: parsed.anchors.file || null,
      headlineSymbols: parsed.symbols.slice(0, 5).map((s) => `${s.kind}:${s.name}@${s.line}`),
      routes: parsed.routes.slice(0, 5).map((r) => `${r.method} ${r.path}`),
    };
    summaries.push(summary);
  }

  const graph = buildGraph(parsedFiles);

  const indexJSON = {
    schemaVersion: SCHEMA_VERSION,
    root,
    builtAt: new Date().toISOString(),
    fileCount: fileRecords.length,
    totalTokens,
    files: fileRecords,
  };

  // Repo fingerprint for stale detection: max mtime + count + size sum.
  const fingerprint = {
    fileCount: fileRecords.length,
    maxMtimeMs: fileRecords.reduce((m, r) => Math.max(m, r.mtimeMs || 0), 0),
    sizeSum: fileRecords.reduce((s, r) => s + (r.size || 0), 0),
    builtAt: indexJSON.builtAt,
  };
  indexJSON.fingerprint = fingerprint;

  store.writeJSON("index", indexJSON);
  store.writeJSONL("symbols", symbols);
  store.writeJSONL("summaries", summaries);
  store.writeJSONL(
    "aliases",
    Array.from(aliases.entries()).map(([alias, hits]) => ({ alias, hits }))
  );
  store.writeJSON("graph", graph.toJSON());
  store.writeJSON("version", { schemaVersion: SCHEMA_VERSION, builtAt: indexJSON.builtAt, fileCount: fileRecords.length, fingerprint });

  const elapsedMs = Date.now() - t0;
  return {
    root,
    elapsedMs,
    fileCount: fileRecords.length,
    parsedCount,
    cachedCount,
    symbolCount: symbols.length,
    totalTokens,
    schemaVersion: SCHEMA_VERSION,
  };
}

// Quickly compute current repo fingerprint without parsing — used to detect stale index.
function computeCurrentFingerprint(rootArg, opts = {}) {
  const root = rootArg ? path.resolve(rootArg) : repoRoot();
  const found = scanRepo(root, opts);
  let maxMtime = 0;
  let sizeSum = 0;
  for (const f of found) {
    if (f.mtimeMs > maxMtime) maxMtime = f.mtimeMs;
    sizeSum += f.size || 0;
  }
  return { fileCount: found.length, maxMtimeMs: maxMtime, sizeSum };
}

function isIndexStale(rootArg, opts = {}) {
  const root = rootArg ? path.resolve(rootArg) : repoRoot();
  const store = new Store(root);
  const idx = store.readJSON("index", null);
  if (!idx || !idx.fingerprint) return { stale: true, reason: "no-fingerprint" };
  const cur = computeCurrentFingerprint(root, opts);
  const prev = idx.fingerprint;
  if (cur.fileCount !== prev.fileCount) return { stale: true, reason: "file-count-changed", prev, cur };
  if (cur.maxMtimeMs !== prev.maxMtimeMs) return { stale: true, reason: "mtime-changed", prev, cur };
  if (cur.sizeSum !== prev.sizeSum) return { stale: true, reason: "size-changed", prev, cur };
  return { stale: false, prev, cur };
}

function loadIndex(rootArg) {
  const root = rootArg ? path.resolve(rootArg) : repoRoot();
  const store = new Store(root);
  const index = store.readJSON("index", null);
  const symbols = store.readJSONL("symbols");
  const summaries = store.readJSONL("summaries");
  const aliasRows = store.readJSONL("aliases");
  const aliases = new Map(aliasRows.map((r) => [r.alias, r.hits]));
  const graph = Graph.fromJSON(store.readJSON("graph", { nodes: [], edges: [] }));
  return { root, store, index, symbols, summaries, aliases, graph };
}

module.exports = { syncIndex, loadIndex, isIndexStale, computeCurrentFingerprint, SCHEMA_VERSION, tokenizeForSearch };
