// @cm-file domain=core/graph exports=Graph,buildGraph role=weighted-impact-graph
// Edges carry weight, reason, confidence, last_seen so impact queries stay explainable.
const path = require("path");

const EDGE_TYPES = [
  "imports", "calls", "called_by", "depends_on",
  "reads", "writes", "emits", "consumes",
  "tested_by", "shares_schema", "configured_by",
  "changes_with", "affects",
];

const NODE_TYPES = [
  "file", "symbol", "module", "route", "job",
  "test", "schema", "event", "query", "migration", "config",
];

function nodeId(type, key) {
  return `${type}::${key}`;
}

class Graph {
  constructor() {
    this.nodes = new Map();      // id -> node
    this.outEdges = new Map();   // id -> [{to, type, weight, reason, confidence, last_seen}]
    this.inEdges = new Map();
  }

  addNode(type, key, attrs = {}) {
    const id = nodeId(type, key);
    if (!this.nodes.has(id)) {
      this.nodes.set(id, { id, type, key, ...attrs });
      this.outEdges.set(id, []);
      this.inEdges.set(id, []);
    } else {
      Object.assign(this.nodes.get(id), attrs);
    }
    return id;
  }

  addEdge(fromId, toId, type, attrs = {}) {
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) return;
    const edge = {
      from: fromId,
      to: toId,
      type,
      weight: attrs.weight ?? 1,
      reason: attrs.reason || type,
      confidence: attrs.confidence ?? 0.8,
      last_seen: attrs.last_seen || Date.now(),
    };
    this.outEdges.get(fromId).push(edge);
    this.inEdges.get(toId).push(edge);
  }

  neighbors(id, opts = {}) {
    const { direction = "both", types = null, limit = 25 } = opts;
    const seen = new Map();
    const collect = (edges, dir) => {
      for (const e of edges) {
        if (types && !types.includes(e.type)) continue;
        const otherId = dir === "out" ? e.to : e.from;
        const prev = seen.get(otherId);
        if (!prev || prev.weight < e.weight) {
          seen.set(otherId, { id: otherId, type: e.type, weight: e.weight, reason: e.reason, confidence: e.confidence, dir });
        }
      }
    };
    if (direction !== "in") collect(this.outEdges.get(id) || [], "out");
    if (direction !== "out") collect(this.inEdges.get(id) || [], "in");
    return Array.from(seen.values())
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit)
      .map((entry) => ({ ...entry, node: this.nodes.get(entry.id) }));
  }

  // Weighted BFS up to `depth` hops; returns ranked impacted nodes excluding the start.
  impact(id, opts = {}) {
    const { depth = 2, limit = 30, decay = 0.55, types = null } = opts;
    if (!this.nodes.has(id)) return [];
    const scores = new Map();
    const reasons = new Map();
    const queue = [{ id, score: 1, hops: 0, path: [] }];
    const visited = new Set([id]);
    while (queue.length) {
      const cur = queue.shift();
      if (cur.hops >= depth) continue;
      const out = this.outEdges.get(cur.id) || [];
      const inc = this.inEdges.get(cur.id) || [];
      const all = [...out.map((e) => ({ ...e, dir: "out", other: e.to })), ...inc.map((e) => ({ ...e, dir: "in", other: e.from }))];
      for (const e of all) {
        if (types && !types.includes(e.type)) continue;
        const next = e.other;
        const propagate = cur.score * decay * (e.weight || 1) * (e.confidence || 0.7);
        const prior = scores.get(next) || 0;
        if (propagate > prior) {
          scores.set(next, propagate);
          reasons.set(next, [...cur.path, `${e.dir === "out" ? "→" : "←"}${e.type}`]);
        }
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ id: next, score: propagate, hops: cur.hops + 1, path: [...cur.path, e.type] });
        }
      }
    }
    scores.delete(id);
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([nid, score]) => ({
        id: nid,
        score: Number(score.toFixed(4)),
        path: reasons.get(nid),
        node: this.nodes.get(nid),
      }))
      .filter((r) => r.node);
  }

  toJSON() {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.outEdges.values()).flat(),
    };
  }

  static fromJSON(data) {
    const g = new Graph();
    if (!data) return g;
    for (const n of data.nodes || []) g.addNode(n.type, n.key, n);
    for (const e of data.edges || []) g.addEdge(e.from, e.to, e.type, e);
    return g;
  }
}

function inferLocalImportTarget(rel, importPath, knownFiles) {
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) return null;
  const fromDir = path.posix.dirname(rel);
  const base = path.posix.normalize(path.posix.join(fromDir, importPath));
  const candidates = [
    base,
    ...[".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".go", ".rs"].map((e) => base + e),
    ...["/index.js", "/index.ts", "/index.tsx", "/__init__.py", "/mod.rs"].map((e) => base + e),
  ];
  for (const c of candidates) {
    if (knownFiles.has(c)) return c;
  }
  return null;
}

// @cm id=buildGraph role=orchestration involves=Graph,parsedFiles affects=cm_neighbors,cm_impact,cm_explain
function buildGraph(parsedFiles) {
  const g = new Graph();
  const fileSet = new Set(parsedFiles.map((f) => f.rel));

  // Pass 1: register every file node so later edges can attach regardless of scan order.
  for (const f of parsedFiles) {
    g.addNode("file", f.rel, { role: f.role, lineCount: f.lineCount, bytes: f.bytes });
  }

  // Pass 2: enrich nodes and add edges.
  for (const f of parsedFiles) {
    for (const s of f.symbols) {
      const sid = g.addNode("symbol", `${f.rel}#${s.name}`, { name: s.name, kind: s.kind, file: f.rel, line: s.line });
      g.addEdge(sid, `file::${f.rel}`, "depends_on", { weight: 0.6, reason: "symbol-in-file", confidence: 0.95 });
      g.addEdge(`file::${f.rel}`, sid, "affects", { weight: 0.4, reason: "file-defines-symbol", confidence: 0.95 });
    }
    for (const r of f.routes) {
      const rid = g.addNode("route", `${r.method} ${r.path}`, { method: r.method, path: r.path, file: f.rel, line: r.line });
      g.addEdge(rid, `file::${f.rel}`, "depends_on", { weight: 0.7, reason: "route-declared-in", confidence: 0.9 });
      g.addEdge(`file::${f.rel}`, rid, "affects", { weight: 0.6, reason: "file-declares-route", confidence: 0.9 });
    }
    for (const t of f.tests) {
      const tid = g.addNode("test", `${f.rel}::${t.name}`, { name: t.name, file: f.rel, line: t.line });
      g.addEdge(tid, `file::${f.rel}`, "tested_by", { weight: 0.5, reason: "test-in-file", confidence: 0.9 });
    }
    for (const imp of f.imports) {
      const target = inferLocalImportTarget(f.rel, imp, fileSet);
      if (target) {
        g.addEdge(`file::${f.rel}`, `file::${target}`, "imports", { weight: 1.0, reason: "static-import", confidence: 0.95 });
        g.addEdge(`file::${target}`, `file::${f.rel}`, "called_by", { weight: 0.7, reason: "imported-by", confidence: 0.85 });
      }
    }

    // Anchor-derived edges - short structured comments enrich the graph cheaply.
    for (const a of f.anchors.items) {
      if (!a.id) continue;
      const sid = g.addNode("symbol", `${f.rel}#${a.id}`, { name: a.id, kind: a.role || "anchor", file: f.rel, line: a.line, anchor: true });
      const involves = Array.isArray(a.involves) ? a.involves : a.involves ? [a.involves] : [];
      const affects = Array.isArray(a.affects) ? a.affects : a.affects ? [a.affects] : [];
      for (const inv of involves) {
        const tid = g.addNode("symbol", inv, { name: inv, kind: "external", anchor: true });
        g.addEdge(sid, tid, "depends_on", { weight: 0.7, reason: "@cm involves", confidence: 0.7 });
      }
      for (const aff of affects) {
        const tid = g.addNode("symbol", aff, { name: aff, kind: "external", anchor: true });
        g.addEdge(sid, tid, "affects", { weight: 0.9, reason: "@cm affects", confidence: 0.8 });
      }
    }
    if (f.anchors.file) {
      const meta = f.anchors.file;
      const exports = Array.isArray(meta.exports) ? meta.exports : meta.exports ? [meta.exports] : [];
      const tests = Array.isArray(meta.tests) ? meta.tests : meta.tests ? [meta.tests] : [];
      for (const ex of exports) {
        const sid = g.addNode("symbol", `${f.rel}#${ex}`, { name: ex, kind: "export", file: f.rel, anchor: true });
        g.addEdge(`file::${f.rel}`, sid, "affects", { weight: 0.5, reason: "@cm-file exports", confidence: 0.85 });
      }
      for (const tref of tests) {
        if (fileSet.has(tref)) {
          g.addEdge(`file::${tref}`, `file::${f.rel}`, "tested_by", { weight: 0.9, reason: "@cm-file tests", confidence: 0.95 });
          g.addEdge(`file::${f.rel}`, `file::${tref}`, "tested_by", { weight: 0.9, reason: "@cm-file tests", confidence: 0.95 });
        }
      }
    }
  }
  return g;
}

module.exports = { Graph, buildGraph, EDGE_TYPES, NODE_TYPES, nodeId };
