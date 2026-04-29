#!/usr/bin/env node
// Honest harness. Runs the same task suite through (a) Code Map (with given variant flags) and
// (b) the rg+selective-read baseline. Computes top-1, top-3, impact P/R/F1, latency, and
// HONEST delivered/raw tokens (size of payload that an agent would actually consume).
//
// Usage:
//   node scripts/harness/run.js                       # default variant (current code)
//   node scripts/harness/run.js --variant=v1-honest   # named variant; flags read from variants.json
//   node scripts/harness/run.js --out=results/before.json
//
// The variant only sets process.env.CM_VARIANT_* — code-map reads those flags itself.
// Saves a single JSON file with per-task results; aggregates printed to stdout.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { locateBaseline, impactBaseline } = require("./baseline_rg");
const { estimateTokens } = require("./tokens");

function parseArgs() {
  const a = { variant: "default", out: null, fresh: false, suite: "suite.json" };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--variant=")) a.variant = arg.slice(10);
    else if (arg.startsWith("--out=")) a.out = arg.slice(6);
    else if (arg.startsWith("--suite=")) a.suite = arg.slice(8);
    else if (arg === "--fresh") a.fresh = true;
  }
  return a;
}

function loadSuite(filename) {
  const p = path.join(__dirname, filename || "suite.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadVariant(name) {
  if (name === "default") return { flags: {} };
  const p = path.join(__dirname, "variants.json");
  if (!fs.existsSync(p)) return { flags: {} };
  const v = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!v[name]) throw new Error(`unknown variant: ${name}`);
  return v[name];
}

function applyFlags(flags) {
  const prev = {};
  for (const [k, v] of Object.entries(flags)) {
    const envKey = "CM_" + k.toUpperCase();
    prev[envKey] = process.env[envKey];
    process.env[envKey] = String(v);
  }
  return prev;
}

function restoreFlags(prev) {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function loadCodeMap() {
  // bust require cache so flag changes affect a fresh load
  for (const k of Object.keys(require.cache)) {
    if (k.includes(path.sep + "src" + path.sep + "core" + path.sep)) delete require.cache[k];
  }
  return require("../../src/core");
}

function repoPath(suite, repoKey) {
  return path.resolve(__dirname, suite.repos[repoKey]);
}

function freshSync(cm, root) {
  // delete .code-map dir if --fresh requested
  const ctx = path.join(root, ".code-map");
  if (fs.existsSync(ctx)) fs.rmSync(ctx, { recursive: true, force: true });
  return cm.cm_sync({ root, force: true });
}

function payloadTokens(payload) {
  // Honest delivered tokens: serialize the payload an agent would receive.
  return estimateTokens(JSON.stringify(payload || {}));
}

function rawCorpusTokens(root) {
  // Honest raw budget: a "naive agent" who would read all source files.
  // Cached per repo per process.
  if (!rawCorpusTokens._cache) rawCorpusTokens._cache = new Map();
  const c = rawCorpusTokens._cache;
  if (c.has(root)) return c.get(root);
  const exts = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".go", ".rs", ".java"]);
  const ignores = new Set(["node_modules", ".git", ".code-map", "dist", "build", "coverage", "target", "vendor"]);
  let total = 0;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (ignores.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (exts.has(path.extname(e.name))) {
        try {
          const s = fs.readFileSync(full, "utf8");
          total += estimateTokens(s);
        } catch {}
      }
    }
  }
  walk(root);
  c.set(root, total);
  return total;
}

function evalLocate(task, predictedTop1, predictedTopK) {
  const ok = predictedTop1 === task.expected_top1;
  const k = task.expected_topk || [task.expected_top1];
  const okk = predictedTopK.slice(0, 3).some((p) => k.includes(p));
  return { top1: ok ? 1 : 0, top3: okk ? 1 : 0 };
}

function evalImpact(task, predicted) {
  const exp = new Set(task.expected_impact || []);
  const pred = new Set((predicted || []).slice(0, 12));
  let tp = 0;
  for (const f of pred) if (exp.has(f)) tp++;
  const fp = pred.size - tp;
  const fn = Math.max(0, exp.size - tp);
  const precision = pred.size === 0 ? 0 : tp / pred.size;
  const recall = exp.size === 0 ? 0 : tp / exp.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1 };
}

function runCM(cm, root, task) {
  if (task.kind === "locate") {
    const t0 = Date.now();
    const r = cm.cm_resolve(task.query, { root, limit: 5, record: false });
    const elapsed = Date.now() - t0;
    const hits = (r && r.hits) || [];
    const top1 = hits[0]?.rel || hits[0]?.path || null;
    const topk = hits.slice(0, 3).map((h) => h.rel || h.path).filter(Boolean);
    let payload = r;
    // if resolver scored low, fall through to search like a real agent would
    let usedFallback = false;
    if (!top1 || (hits[0]?.score || 0) < 0.6) {
      const s = cm.cm_search(task.query, { root, limit: 5, record: false });
      if (s && s.hits && s.hits.length) {
        const sTop = s.hits[0].rel || s.hits[0].path;
        if (sTop) {
          payload = s;
          usedFallback = true;
          return {
            top1: sTop,
            topk: s.hits.slice(0, 3).map((h) => h.rel || h.path).filter(Boolean),
            delivered_tokens: payloadTokens(payload),
            elapsedMs: elapsed + (s.elapsedMs || 0),
            usedFallback,
          };
        }
      }
    }
    return {
      top1,
      topk,
      delivered_tokens: payloadTokens(payload),
      elapsedMs: elapsed,
      usedFallback,
    };
  }
  if (task.kind === "impact") {
    const t0 = Date.now();
    const r = cm.cm_impact(task.target, { root, depth: 2, limit: 12, record: false });
    const elapsed = Date.now() - t0;
    // Code Map's impact returns {impact:[{id,score,node:{type,key}}]}.
    // Project to file paths: prefer node.type==="file" -> node.key, else extract file from "file::path" id or "symbol::path#name" id.
    const items = (r && r.impact) || [];
    const files = [];
    const seen = new Set();
    for (const it of items) {
      let f = null;
      // Slim format puts rel directly on the item.
      if (it && typeof it.rel === "string") f = it.rel;
      else if (it && it.node && it.node.type === "file" && it.node.key) f = it.node.key;
      else if (it && it.node && it.node.file) f = it.node.file;
      else if (it && typeof it.id === "string") {
        const m = it.id.match(/^(?:file::|symbol::)([^#]+)/);
        if (m) f = m[1];
      }
      if (f && !seen.has(f) && f !== task.target) {
        seen.add(f);
        files.push(f);
      }
    }
    return {
      impact: files,
      delivered_tokens: payloadTokens(r),
      elapsedMs: elapsed,
    };
  }
  throw new Error("unknown kind: " + task.kind);
}

function runOne(cm, suite, task) {
  const root = repoPath(suite, task.repo);
  const raw = rawCorpusTokens(root);

  // Code Map side
  const cmRes = runCM(cm, root, task);
  // Baseline side
  const blRes = task.kind === "locate"
    ? locateBaseline(root, task.query)
    : impactBaseline(root, task.target);

  const cmEval = task.kind === "locate"
    ? evalLocate(task, cmRes.top1, cmRes.topk)
    : evalImpact(task, cmRes.impact);
  const blEval = task.kind === "locate"
    ? evalLocate(task, blRes.top1, blRes.topk)
    : evalImpact(task, blRes.impact);

  return {
    id: task.id,
    repo: task.repo,
    kind: task.kind,
    raw_tokens: raw,
    code_map: {
      delivered_tokens: cmRes.delivered_tokens,
      saved_tokens: Math.max(0, raw - cmRes.delivered_tokens),
      saved_percent: raw === 0 ? 0 : (raw - cmRes.delivered_tokens) / raw,
      elapsedMs: cmRes.elapsedMs,
      eval: cmEval,
      top1: cmRes.top1,
      topk: cmRes.topk,
      impact: cmRes.impact,
      usedFallback: !!cmRes.usedFallback,
    },
    baseline: {
      delivered_tokens: blRes.delivered_tokens,
      saved_tokens: Math.max(0, raw - blRes.delivered_tokens),
      saved_percent: raw === 0 ? 0 : (raw - blRes.delivered_tokens) / raw,
      elapsedMs: blRes.elapsedMs,
      eval: blEval,
      top1: blRes.top1,
      topk: blRes.topk,
      impact: blRes.impact,
    },
    head_to_head: {
      delivered_tokens_diff: cmRes.delivered_tokens - blRes.delivered_tokens,
      delivered_tokens_ratio: blRes.delivered_tokens === 0 ? null : cmRes.delivered_tokens / blRes.delivered_tokens,
      cm_better_quality:
        task.kind === "locate"
          ? (cmEval.top1 - blEval.top1) > 0 || ((cmEval.top1 === blEval.top1) && (cmEval.top3 - blEval.top3) > 0)
          : cmEval.f1 > blEval.f1 + 1e-9,
      cm_worse_quality:
        task.kind === "locate"
          ? (cmEval.top1 - blEval.top1) < 0 || ((cmEval.top1 === blEval.top1) && (cmEval.top3 - blEval.top3) < 0)
          : cmEval.f1 < blEval.f1 - 1e-9,
    },
  };
}

function aggregate(results) {
  const acc = (sel) => results.reduce((s, r) => s + sel(r), 0);
  const locate = results.filter((r) => r.kind === "locate");
  const impact = results.filter((r) => r.kind === "impact");
  const sumCM = acc((r) => r.code_map.delivered_tokens);
  const sumBL = acc((r) => r.baseline.delivered_tokens);
  const sumRaw = acc((r) => r.raw_tokens);
  const top1cm = locate.reduce((s, r) => s + r.code_map.eval.top1, 0);
  const top1bl = locate.reduce((s, r) => s + r.baseline.eval.top1, 0);
  const top3cm = locate.reduce((s, r) => s + r.code_map.eval.top3, 0);
  const top3bl = locate.reduce((s, r) => s + r.baseline.eval.top3, 0);
  const f1cm = impact.length === 0 ? 0 : impact.reduce((s, r) => s + r.code_map.eval.f1, 0) / impact.length;
  const f1bl = impact.length === 0 ? 0 : impact.reduce((s, r) => s + r.baseline.eval.f1, 0) / impact.length;
  const recallCm = impact.length === 0 ? 0 : impact.reduce((s, r) => s + r.code_map.eval.recall, 0) / impact.length;
  const recallBl = impact.length === 0 ? 0 : impact.reduce((s, r) => s + r.baseline.eval.recall, 0) / impact.length;
  const precCm = impact.length === 0 ? 0 : impact.reduce((s, r) => s + r.code_map.eval.precision, 0) / impact.length;
  const precBl = impact.length === 0 ? 0 : impact.reduce((s, r) => s + r.baseline.eval.precision, 0) / impact.length;
  return {
    n_tasks: results.length,
    n_locate: locate.length,
    n_impact: impact.length,
    code_map: {
      delivered_tokens_total: sumCM,
      saved_vs_raw_pct: sumRaw === 0 ? 0 : (sumRaw - sumCM) / sumRaw,
      top1_acc: locate.length ? top1cm / locate.length : 0,
      top3_acc: locate.length ? top3cm / locate.length : 0,
      impact_f1: f1cm,
      impact_recall: recallCm,
      impact_precision: precCm,
    },
    baseline: {
      delivered_tokens_total: sumBL,
      saved_vs_raw_pct: sumRaw === 0 ? 0 : (sumRaw - sumBL) / sumRaw,
      top1_acc: locate.length ? top1bl / locate.length : 0,
      top3_acc: locate.length ? top3bl / locate.length : 0,
      impact_f1: f1bl,
      impact_recall: recallBl,
      impact_precision: precBl,
    },
    head_to_head: {
      delivered_tokens_ratio_cm_over_baseline: sumBL === 0 ? null : sumCM / sumBL,
      cm_saves_vs_baseline_pct: sumBL === 0 ? null : (sumBL - sumCM) / sumBL,
      cm_quality_locate_top1_diff: locate.length ? (top1cm - top1bl) / locate.length : 0,
      cm_quality_impact_f1_diff: f1cm - f1bl,
    },
    raw_corpus_tokens_total: sumRaw,
  };
}

function main() {
  const args = parseArgs();
  const suite = loadSuite(args.suite);
  const variant = loadVariant(args.variant);
  const prev = applyFlags(variant.flags || {});
  try {
    const cm = loadCodeMap();
    // sync each repo once (fresh if requested)
    const repos = new Set(suite.tasks.map((t) => t.repo));
    for (const r of repos) {
      const root = repoPath(suite, r);
      if (args.fresh) freshSync(cm, root);
      else cm.cm_sync({ root });
    }
    const results = [];
    for (const t of suite.tasks) {
      const r = runOne(cm, suite, t);
      results.push(r);
      const cmStr = t.kind === "locate"
        ? `top1=${r.code_map.eval.top1} top3=${r.code_map.eval.top3}`
        : `f1=${r.code_map.eval.f1.toFixed(2)} P=${r.code_map.eval.precision.toFixed(2)} R=${r.code_map.eval.recall.toFixed(2)}`;
      const blStr = t.kind === "locate"
        ? `top1=${r.baseline.eval.top1} top3=${r.baseline.eval.top3}`
        : `f1=${r.baseline.eval.f1.toFixed(2)} P=${r.baseline.eval.precision.toFixed(2)} R=${r.baseline.eval.recall.toFixed(2)}`;
      process.stdout.write(`[${t.id}] cm(${r.code_map.delivered_tokens}t ${cmStr}) bl(${r.baseline.delivered_tokens}t ${blStr})\n`);
    }
    const agg = aggregate(results);
    const payload = { variant: args.variant, flags: variant.flags || {}, generatedAt: new Date().toISOString(), aggregate: agg, results };
    if (args.out) {
      fs.mkdirSync(path.dirname(args.out), { recursive: true });
      fs.writeFileSync(args.out, JSON.stringify(payload, null, 2));
      process.stdout.write(`\nwrote ${args.out}\n`);
    }
    process.stdout.write(`\nAGG ${args.variant}: cm_top1=${agg.code_map.top1_acc.toFixed(2)} cm_f1=${agg.code_map.impact_f1.toFixed(2)} cm_tokens=${agg.code_map.delivered_tokens_total} | bl_top1=${agg.baseline.top1_acc.toFixed(2)} bl_f1=${agg.baseline.impact_f1.toFixed(2)} bl_tokens=${agg.baseline.delivered_tokens_total} | ratio=${agg.head_to_head.delivered_tokens_ratio_cm_over_baseline?.toFixed(3)} cm_saves_vs_bl=${(agg.head_to_head.cm_saves_vs_baseline_pct * 100).toFixed(1)}%\n`);
  } finally {
    restoreFlags(prev);
  }
}

if (require.main === module) main();
module.exports = { main };
