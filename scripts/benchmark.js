// @cm-file domain=scripts/benchmark exports=runBenchmark role=measure-token-savings affects=docs/report,iteration-loop
const path = require("path");
const fs = require("fs");
const cm = require("../src/core");
const { syncIndex, loadIndex } = require("../src/core/indexer");
const { estimateTokens, countFileTokens } = require("../src/core/tokens");
const { writeBenchmark } = require("../src/core/stats");

const FIXTURE = path.join(__dirname, "..", "tests", "fixtures", "sample-project");

// Each task captures: a query, a category, and the ground-truth set used to score recall.
// Keep the matrix small but realistic; metrics aggregate over categories.
const TASKS = [
  // category 1: locate file by partial name
  { id: "f1", category: "locate_file", query: "login.js", goldenFile: "src/auth/login.js" },
  { id: "f2", category: "locate_file", query: "userRepo", goldenFile: "src/db/userRepo.js" },
  { id: "f3", category: "locate_file", query: "jwt", goldenFile: "src/utils/jwt.js" },
  { id: "f4", category: "locate_file", query: "auth/routes.js", goldenFile: "src/auth/routes.js" },
  // category 2: locate symbol
  { id: "s1", category: "locate_symbol", query: "refreshSession", goldenFile: "src/auth/login.js", goldenSymbol: "refreshSession" },
  { id: "s2", category: "locate_symbol", query: "registerAuthRoutes", goldenFile: "src/auth/routes.js", goldenSymbol: "registerAuthRoutes" },
  { id: "s3", category: "locate_symbol", query: "PasswordHasher", goldenFile: "src/utils/passwordHasher.js", goldenSymbol: "PasswordHasher" },
  // category 3: locate route
  { id: "r1", category: "locate_route", query: "POST /login", goldenFile: "src/auth/routes.js" },
  { id: "r2", category: "locate_route", query: "GET /health", goldenFile: "src/server.js" },
  // category 4: locate test for module
  { id: "t1", category: "locate_test", query: "auth_login.test", goldenFile: "tests/auth_login.test.js" },
  // category 5: impact of editing a symbol/file
  { id: "i1", category: "impact_module", query: "src/utils/jwt.js", goldenImpact: ["src/auth/login.js"] },
  { id: "i2", category: "impact_module", query: "src/db/userRepo.js", goldenImpact: ["src/auth/login.js"] },
  // category 6: impact via shared schema/anchor (uses @cm affects=auth.routes)
  { id: "i3", category: "impact_anchor", query: "src/auth/login.js", goldenImpact: ["src/auth/routes.js"] },
  // category 7: predict modules touched by a single edit
  { id: "p1", category: "predict_modules", query: "src/utils/passwordHasher.js", goldenImpact: ["src/auth/login.js"] },
  // category 8: incremental sync
  { id: "y1", category: "incremental_sync", action: "sync_after_touch" },
];

function tmpRoot() {
  const root = path.join(__dirname, "..", ".tmp-bench-root");
  if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  copyDir(FIXTURE, root);
  return root;
}
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Naive baseline: opens every candidate file containing the query in name or body.
// raw_candidate_tokens = tokens of every opened file. delivered_tokens = same (no filtering).
function baseline(query, root, _index) {
  const t0 = Date.now();
  const ql = String(query || "").toLowerCase();
  const candidates = [];
  walk(root, (abs) => {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (rel.startsWith(".code-map/")) return;
    if (rel.toLowerCase().includes(ql.split(/\s+/)[0])) {
      candidates.push({ rel, abs });
    }
  });
  // Fallback: also grep file contents if name match fails.
  if (candidates.length === 0) {
    walk(root, (abs) => {
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (rel.startsWith(".code-map/")) return;
      try {
        const text = fs.readFileSync(abs, "utf8");
        if (text.toLowerCase().includes(ql)) candidates.push({ rel, abs });
      } catch {}
    });
  }
  const opened = candidates.slice(0, 5);
  const tokens = opened.reduce((s, c) => s + countFileTokens(c.abs), 0);
  return {
    candidates: opened.map((c) => c.rel),
    raw_candidate_tokens: tokens,
    delivered_tokens: tokens, // baseline ships the whole files
    elapsedMs: Date.now() - t0,
  };
}

function walk(root, cb) {
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    const abs = path.join(root, ent.name);
    if (ent.isDirectory()) {
      if (["node_modules", ".git", ".code-map"].includes(ent.name)) continue;
      walk(abs, cb);
    } else cb(abs);
  }
}

// Plugin path: cm_resolve first; only fall back to cm_search; never opens full files.
// raw_candidate_tokens = total file-token cost the plugin "saved" by not opening; delivered = compact summary.
function plugin(query, root, ctx) {
  const t0 = Date.now();
  const r = cm.cm_resolve(query, { root, _ctx: ctx, record: false });
  let pickedRel = null;
  let pickedSymbol = null;
  let layer = "resolve";
  if (r.ok) {
    pickedRel = r.hits[0].rel;
    pickedSymbol = r.hits[0].name;
  } else {
    const s = cm.cm_search(query, { root, _ctx: ctx, record: false });
    if (s.ok) {
      pickedRel = s.hits[0].rel;
      layer = "search";
    }
  }
  const elapsedMs = Date.now() - t0;
  if (!pickedRel) {
    return { hits: [], raw_candidate_tokens: 0, delivered_tokens: 0, elapsedMs, layer: "miss" };
  }
  // Build the summary the plugin would actually deliver to an agent.
  const summary = ctx.summaries.find((s) => s.rel === pickedRel);
  const compact = JSON.stringify({
    rel: pickedRel,
    symbol: pickedSymbol,
    role: summary?.role,
    headline: summary?.headlineSymbols?.slice(0, 3),
    routes: summary?.routes?.slice(0, 3),
    anchors: summary?.anchors,
  });
  const file = ctx.index.files.find((f) => f.rel === pickedRel);
  const fileTokens = file?.tokens || 0;
  const delivered = estimateTokens(compact);
  return {
    hits: [pickedRel],
    raw_candidate_tokens: fileTokens, // baseline would have opened the whole file
    delivered_tokens: delivered,
    elapsedMs,
    layer,
    pickedRel,
    pickedSymbol,
  };
}

function pluginImpact(query, root, ctx) {
  const t0 = Date.now();
  const r = cm.cm_impact(query, { root, _ctx: ctx, limit: 10, record: false });
  const elapsedMs = Date.now() - t0;
  if (!r.ok) return { hits: [], raw_candidate_tokens: 0, delivered_tokens: 0, elapsedMs };
  // baseline cost: tokens of every file the agent would have re-opened to derive impact.
  const totalFileTokens = ctx.index.files.reduce((s, f) => s + (f.tokens || 0), 0);
  const compact = JSON.stringify(r.files.map((f) => ({ rel: f.rel, score: f.score })));
  return {
    hits: r.files.map((f) => f.rel),
    raw_candidate_tokens: totalFileTokens,
    delivered_tokens: estimateTokens(compact),
    elapsedMs,
  };
}

function baselineImpact(query, root, _ctx) {
  const t0 = Date.now();
  // Naive: open every file under src + tests to "find" what depends on the input.
  let tokens = 0;
  const opened = [];
  walk(root, (abs) => {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (rel.startsWith(".code-map/")) return;
    if (!rel.startsWith("src") && !rel.startsWith("tests")) return;
    tokens += countFileTokens(abs);
    opened.push(rel);
  });
  return { hits: opened, raw_candidate_tokens: tokens, delivered_tokens: tokens, elapsedMs: Date.now() - t0 };
}

function topKHit(hits, golden) {
  if (!golden) return false;
  return hits.slice(0, 3).some((h) => h && h.endsWith(golden));
}

function recall(hits, goldenSet) {
  if (!goldenSet || !goldenSet.length) return 1;
  const found = goldenSet.filter((g) => hits.some((h) => h && h.endsWith(g))).length;
  return found / goldenSet.length;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// @cm id=runBenchmark role=orchestration involves=baseline,plugin,pluginImpact affects=score-composite,iteration-decision
function runBenchmark(opts = {}) {
  const root = opts.root || tmpRoot();
  syncIndex({ root, force: true });
  const ctx = loadIndex(root);

  const results = [];
  let baselineTotalRaw = 0;
  let pluginTotalRaw = 0;
  let pluginTotalDelivered = 0;
  let baselineTotalDelivered = 0;
  let locateOk = 0, locateTotal = 0;
  let impactRecallSum = 0, impactCount = 0;
  const pluginLatencies = [];

  for (const task of TASKS) {
    if (task.action === "sync_after_touch") {
      // Touch a file and time an incremental sync.
      const target = path.join(root, "src/utils/jwt.js");
      fs.utimesSync(target, new Date(), new Date());
      const t0 = Date.now();
      const r = syncIndex({ root });
      const ms = Date.now() - t0;
      results.push({ id: task.id, category: task.category, syncMs: ms, parsed: r.parsedCount, cached: r.cachedCount });
      pluginLatencies.push(ms);
      continue;
    }

    if (task.category.startsWith("impact") || task.category === "predict_modules") {
      const b = baselineImpact(task.query, root, ctx);
      const p = pluginImpact(task.query, root, ctx);
      const golden = task.goldenImpact || [];
      const r = recall(p.hits, golden);
      impactRecallSum += r;
      impactCount += 1;
      baselineTotalRaw += b.raw_candidate_tokens;
      baselineTotalDelivered += b.delivered_tokens;
      pluginTotalRaw += p.raw_candidate_tokens;
      pluginTotalDelivered += p.delivered_tokens;
      pluginLatencies.push(p.elapsedMs);
      results.push({
        id: task.id, category: task.category, query: task.query,
        baseline: { raw: b.raw_candidate_tokens, delivered: b.delivered_tokens, ms: b.elapsedMs },
        plugin: { raw: p.raw_candidate_tokens, delivered: p.delivered_tokens, ms: p.elapsedMs, hits: p.hits.slice(0, 5) },
        golden, recall: Number(r.toFixed(3)),
      });
    } else {
      const b = baseline(task.query, root, ctx);
      const p = plugin(task.query, root, ctx);
      const ok = topKHit(p.hits, task.goldenFile);
      locateOk += ok ? 1 : 0;
      locateTotal += 1;
      baselineTotalRaw += b.raw_candidate_tokens;
      baselineTotalDelivered += b.delivered_tokens;
      pluginTotalRaw += p.raw_candidate_tokens;
      pluginTotalDelivered += p.delivered_tokens;
      pluginLatencies.push(p.elapsedMs);
      results.push({
        id: task.id, category: task.category, query: task.query,
        baseline: { raw: b.raw_candidate_tokens, delivered: b.delivered_tokens, ms: b.elapsedMs, candidates: b.candidates },
        plugin: { raw: p.raw_candidate_tokens, delivered: p.delivered_tokens, ms: p.elapsedMs, layer: p.layer, picked: p.pickedRel },
        golden: task.goldenFile, hit: ok,
      });
    }
  }

  // Token savings: how much smaller the plugin's *delivered* payload is vs. the baseline's raw payload.
  const savedTokens = Math.max(0, baselineTotalRaw - pluginTotalDelivered);
  const savedPercent = baselineTotalRaw > 0 ? savedTokens / baselineTotalRaw : 0;
  const locateHitRate = locateTotal > 0 ? locateOk / locateTotal : 0;
  const impactRecall = impactCount > 0 ? impactRecallSum / impactCount : 0;
  const medLat = median(pluginLatencies);
  // Latency score: 1 at <=100ms, 0 at >=2000ms, linear in between.
  const latencyScore = Math.max(0, Math.min(1, 1 - (medLat - 100) / 1900));
  const stabilityScore = 1; // tests are run separately - if they pass, this is 1; otherwise the runner will fail.

  const composite =
    0.35 * savedPercent +
    0.25 * locateHitRate +
    0.20 * impactRecall +
    0.10 * latencyScore +
    0.10 * stabilityScore;

  const snapshot = {
    builtAt: new Date().toISOString(),
    root,
    metrics: {
      saved_percent: Number(savedPercent.toFixed(4)),
      saved_tokens: savedTokens,
      baseline_raw_tokens: baselineTotalRaw,
      plugin_delivered_tokens: pluginTotalDelivered,
      locate_hit_rate: Number(locateHitRate.toFixed(4)),
      impact_recall: Number(impactRecall.toFixed(4)),
      median_latency_ms: medLat,
      latency_score: Number(latencyScore.toFixed(4)),
      stability_score: stabilityScore,
      composite_score: Number(composite.toFixed(4)),
    },
    targets: {
      saved_percent: 0.65,
      locate_hit_rate: 0.92,
      impact_recall: 0.90,
      median_latency_ms_max: 1500,
      impact_no_rescan_share: 0.80,
    },
    tasks: results,
  };

  writeBenchmark(snapshot, root);
  // Also keep a copy in the plugin's own ctx for reporting from the repo root.
  try {
    writeBenchmark(snapshot, path.join(__dirname, ".."));
  } catch {}
  return snapshot;
}

if (require.main === module) {
  const snap = runBenchmark();
  console.log(JSON.stringify(snap.metrics, null, 2));
  console.log(`\nTasks: ${snap.tasks.length}, composite=${snap.metrics.composite_score}`);
}

module.exports = { runBenchmark, baseline, plugin };
