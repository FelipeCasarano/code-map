// @cm-file domain=scripts/benchmark-self exports=runSelfBenchmark role=larger-realistic-benchmark affects=iteration-loop
// Runs the same harness against the plugin's own repo - a larger and more realistic test bed.
const path = require("path");
const fs = require("fs");
const cm = require("../src/core");
const { syncIndex, loadIndex } = require("../src/core/indexer");
const { estimateTokens, countFileTokens } = require("../src/core/tokens");
const { writeBenchmark } = require("../src/core/stats");

const REPO = path.join(__dirname, "..");

const TASKS = [
  { id: "f1", category: "locate_file", query: "graph.js", goldenFile: "src/core/graph.js" },
  { id: "f2", category: "locate_file", query: "resolver.js", goldenFile: "src/core/resolver.js" },
  { id: "f3", category: "locate_file", query: "scanner", goldenFile: "src/core/scanner.js" },
  { id: "f4", category: "locate_file", query: "tokens.js", goldenFile: "src/core/tokens.js" },
  { id: "f5", category: "locate_file", query: "src/cli/index.js", goldenFile: "src/cli/index.js" },
  { id: "s1", category: "locate_symbol", query: "buildGraph", goldenFile: "src/core/graph.js", goldenSymbol: "buildGraph" },
  { id: "s2", category: "locate_symbol", query: "syncIndex", goldenFile: "src/core/indexer.js", goldenSymbol: "syncIndex" },
  { id: "s3", category: "locate_symbol", query: "estimateTokens", goldenFile: "src/core/tokens.js", goldenSymbol: "estimateTokens" },
  { id: "s4", category: "locate_symbol", query: "parseAnchors", goldenFile: "src/core/anchors.js", goldenSymbol: "parseAnchors" },
  { id: "s5", category: "locate_symbol", query: "recordEvent", goldenFile: "src/core/stats.js", goldenSymbol: "recordEvent" },
  { id: "s6", category: "locate_symbol", query: "Store", goldenFile: "src/core/db.js", goldenSymbol: "Store" },
  // impact
  { id: "i1", category: "impact_module", query: "src/core/graph.js", goldenImpact: ["src/core/indexer.js", "src/core/neighbors.js", "src/core/impact.js"] },
  { id: "i2", category: "impact_module", query: "src/core/indexer.js", goldenImpact: ["src/core/resolver.js", "src/core/search.js", "src/core/neighbors.js", "src/core/impact.js", "src/core/explain.js"] },
  { id: "i3", category: "impact_module", query: "src/core/parser.js", goldenImpact: ["src/core/indexer.js"] },
  { id: "i4", category: "impact_module", query: "src/core/tokens.js", goldenImpact: ["src/core/indexer.js", "src/core/stats.js"] },
  { id: "i5", category: "impact_module", query: "src/core/db.js", goldenImpact: ["src/core/indexer.js", "src/core/stats.js"] },
  // incremental sync
  { id: "y1", category: "incremental_sync", action: "sync_after_touch" },
];

function baseline(query, root) {
  const t0 = Date.now();
  const ql = String(query || "").toLowerCase();
  const candidates = [];
  walk(root, (abs) => {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (rel.startsWith(".code-map/")) return;
    if (rel.startsWith("node_modules/")) return;
    if (rel.toLowerCase().includes(ql.split(/\s+/)[0])) candidates.push({ rel, abs });
  });
  if (candidates.length === 0) {
    walk(root, (abs) => {
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (rel.startsWith(".code-map/")) return;
      if (rel.startsWith("node_modules/")) return;
      try {
        const text = fs.readFileSync(abs, "utf8");
        if (text.toLowerCase().includes(ql)) candidates.push({ rel, abs });
      } catch {}
    });
  }
  const opened = candidates.slice(0, 5);
  const tokens = opened.reduce((s, c) => s + countFileTokens(c.abs), 0);
  return { candidates: opened.map((c) => c.rel), raw_candidate_tokens: tokens, delivered_tokens: tokens, elapsedMs: Date.now() - t0 };
}

function walk(root, cb) {
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    const abs = path.join(root, ent.name);
    if (ent.isDirectory()) {
      if (["node_modules", ".git", ".code-map", ".tmp-test-root", ".tmp-bench-root"].includes(ent.name)) continue;
      walk(abs, cb);
    } else cb(abs);
  }
}

function plugin(query, root, ctx) {
  const t0 = Date.now();
  const r = cm.cm_resolve(query, { root, _ctx: ctx, record: false });
  let pickedRel = null, pickedSymbol = null, layer = "resolve";
  if (r.ok) { pickedRel = r.hits[0].rel; pickedSymbol = r.hits[0].name; }
  else {
    const s = cm.cm_search(query, { root, _ctx: ctx, record: false });
    if (s.ok) { pickedRel = s.hits[0].rel; layer = "search"; }
  }
  const elapsedMs = Date.now() - t0;
  if (!pickedRel) return { hits: [], raw_candidate_tokens: 0, delivered_tokens: 0, elapsedMs, layer: "miss" };
  const summary = ctx.summaries.find((s) => s.rel === pickedRel);
  const compact = JSON.stringify({ rel: pickedRel, symbol: pickedSymbol, role: summary?.role, headline: summary?.headlineSymbols?.slice(0, 3), routes: summary?.routes?.slice(0, 3), anchors: summary?.anchors });
  const file = ctx.index.files.find((f) => f.rel === pickedRel);
  return { hits: [pickedRel], raw_candidate_tokens: file?.tokens || 0, delivered_tokens: estimateTokens(compact), elapsedMs, layer, pickedRel, pickedSymbol };
}

function pluginImpact(query, root, ctx) {
  const t0 = Date.now();
  const r = cm.cm_impact(query, { root, _ctx: ctx, limit: 15, depth: 3, record: false });
  const elapsedMs = Date.now() - t0;
  if (!r.ok) return { hits: [], raw_candidate_tokens: 0, delivered_tokens: 0, elapsedMs };
  const totalFileTokens = ctx.index.files.reduce((s, f) => s + (f.tokens || 0), 0);
  const compact = JSON.stringify(r.files.map((f) => ({ rel: f.rel, score: f.score })));
  return { hits: r.files.map((f) => f.rel), raw_candidate_tokens: totalFileTokens, delivered_tokens: estimateTokens(compact), elapsedMs };
}

function baselineImpact(_query, root) {
  let tokens = 0;
  const opened = [];
  walk(root, (abs) => {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (rel.startsWith(".code-map/")) return;
    if (!rel.startsWith("src") && !rel.startsWith("tests") && !rel.startsWith("scripts")) return;
    tokens += countFileTokens(abs);
    opened.push(rel);
  });
  return { hits: opened, raw_candidate_tokens: tokens, delivered_tokens: tokens, elapsedMs: 0 };
}

function topKHit(hits, golden) { return hits.slice(0, 3).some((h) => h && h.endsWith(golden)); }
function recall(hits, goldenSet) {
  if (!goldenSet || !goldenSet.length) return 1;
  const found = goldenSet.filter((g) => hits.some((h) => h && h.endsWith(g))).length;
  return found / goldenSet.length;
}
function median(arr) { if (!arr.length) return 0; const s = [...arr].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; }

function runSelfBenchmark(opts = {}) {
  const root = opts.root || REPO;
  syncIndex({ root, force: true });
  const ctx = loadIndex(root);
  const results = [];
  let baselineTotalRaw = 0, pluginTotalDelivered = 0;
  let locateOk = 0, locateTotal = 0;
  let impactRecallSum = 0, impactCount = 0;
  let impactNoRescan = 0;
  const pluginLatencies = [];

  for (const task of TASKS) {
    if (task.action === "sync_after_touch") {
      const target = path.join(root, "src/core/tokens.js");
      fs.utimesSync(target, new Date(), new Date());
      const t0 = Date.now();
      const r = syncIndex({ root });
      const ms = Date.now() - t0;
      results.push({ id: task.id, category: task.category, syncMs: ms, parsed: r.parsedCount, cached: r.cachedCount });
      pluginLatencies.push(ms);
      continue;
    }
    if (task.category.startsWith("impact")) {
      const b = baselineImpact(task.query, root);
      const p = pluginImpact(task.query, root, ctx);
      const r = recall(p.hits, task.goldenImpact || []);
      impactRecallSum += r; impactCount += 1;
      if (p.hits.length > 0) impactNoRescan += 1;
      baselineTotalRaw += b.raw_candidate_tokens;
      pluginTotalDelivered += p.delivered_tokens;
      pluginLatencies.push(p.elapsedMs);
      results.push({ id: task.id, category: task.category, query: task.query, baseline: { raw: b.raw_candidate_tokens }, plugin: { delivered: p.delivered_tokens, ms: p.elapsedMs, hits: p.hits.slice(0, 8) }, golden: task.goldenImpact, recall: Number(r.toFixed(3)) });
    } else {
      const b = baseline(task.query, root);
      const p = plugin(task.query, root, ctx);
      const ok = topKHit(p.hits, task.goldenFile);
      locateOk += ok ? 1 : 0; locateTotal += 1;
      baselineTotalRaw += b.raw_candidate_tokens;
      pluginTotalDelivered += p.delivered_tokens;
      pluginLatencies.push(p.elapsedMs);
      results.push({ id: task.id, category: task.category, query: task.query, baseline: { raw: b.raw_candidate_tokens, candidates: b.candidates }, plugin: { delivered: p.delivered_tokens, ms: p.elapsedMs, layer: p.layer, picked: p.pickedRel }, golden: task.goldenFile, hit: ok });
    }
  }

  const savedTokens = Math.max(0, baselineTotalRaw - pluginTotalDelivered);
  const savedPercent = baselineTotalRaw > 0 ? savedTokens / baselineTotalRaw : 0;
  const locateHitRate = locateTotal > 0 ? locateOk / locateTotal : 0;
  const impactRecall = impactCount > 0 ? impactRecallSum / impactCount : 0;
  const impactNoRescanShare = impactCount > 0 ? impactNoRescan / impactCount : 0;
  const medLat = median(pluginLatencies);
  const latencyScore = Math.max(0, Math.min(1, 1 - (medLat - 100) / 1900));
  const stabilityScore = 1;
  const composite = 0.35 * savedPercent + 0.25 * locateHitRate + 0.20 * impactRecall + 0.10 * latencyScore + 0.10 * stabilityScore;

  const snapshot = {
    name: "self",
    builtAt: new Date().toISOString(),
    root,
    metrics: {
      saved_percent: Number(savedPercent.toFixed(4)),
      saved_tokens: savedTokens,
      baseline_raw_tokens: baselineTotalRaw,
      plugin_delivered_tokens: pluginTotalDelivered,
      locate_hit_rate: Number(locateHitRate.toFixed(4)),
      impact_recall: Number(impactRecall.toFixed(4)),
      impact_no_rescan_share: Number(impactNoRescanShare.toFixed(4)),
      median_latency_ms: medLat,
      latency_score: Number(latencyScore.toFixed(4)),
      stability_score: stabilityScore,
      composite_score: Number(composite.toFixed(4)),
    },
    targets: { saved_percent: 0.65, locate_hit_rate: 0.92, impact_recall: 0.90, median_latency_ms_max: 1500, impact_no_rescan_share: 0.80 },
    tasks: results,
  };
  writeBenchmark(snapshot, root);
  return snapshot;
}

if (require.main === module) {
  const snap = runSelfBenchmark();
  console.log(JSON.stringify(snap.metrics, null, 2));
  console.log(`\nTasks: ${snap.tasks.length}`);
  for (const t of snap.tasks) {
    if (t.category === "incremental_sync") console.log(`  [${t.id}] sync ms=${t.syncMs} parsed=${t.parsed} cached=${t.cached}`);
    else if (t.category.startsWith("impact")) console.log(`  [${t.id}] ${t.category} ${t.query} recall=${t.recall} hits=[${(t.plugin.hits||[]).slice(0,3).join(", ")}]`);
    else console.log(`  [${t.id}] ${t.category} "${t.query}" hit=${t.hit} layer=${t.plugin.layer} picked=${t.plugin.picked}`);
  }
}

module.exports = { runSelfBenchmark };
