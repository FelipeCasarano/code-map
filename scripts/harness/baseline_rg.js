// Honest rg-equivalent + selective-read baseline, in pure Node.
// Models a disciplined agent: recursive regex grep over source files, take top-matched files,
// read each fully if small or read a window around first match.
// Tokens charged = bytes of grep output + bytes of file slices the "agent" actually consumes.
//
// Pure-Node implementation chosen because rg in this environment is a Claude Code wrapper
// not callable from Node; for fair comparison the algorithm is what matters, not the tool.
const fs = require("fs");
const path = require("path");
const { estimateTokens } = require("./tokens");

const SOURCE_EXT = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".go", ".rs", ".java"]);
const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".code-map", "dist", "build", "out", "coverage",
  ".next", ".nuxt", ".cache", ".turbo", "target", "vendor", ".idea", ".vscode-test",
  "__pycache__", ".pytest_cache", ".venv", "venv",
]);
const READ_WINDOW = 200;
const MAX_FILES_READ = 3;
const MAX_MATCHES_PER_FILE = 5;

function walk(root) {
  const out = [];
  function go(dir) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (IGNORE_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) go(full);
      else if (SOURCE_EXT.has(path.extname(e.name))) out.push(full);
    }
  }
  go(root);
  return out;
}

function rel(p, root) {
  return path.relative(root, p).split(path.sep).join("/");
}

function tokenizeQueryForGrep(query) {
  const out = [];
  const trimmed = query.trim();
  const routeMatch = trimmed.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(\/\S+)$/i);
  if (routeMatch) out.push(routeMatch[2]);
  out.push(trimmed);
  // identifier list joined by | for an OR pattern
  const ids = trimmed.match(/[A-Za-z_][A-Za-z0-9_]+/g);
  if (ids && ids.length) out.push(ids.join("|"));
  return Array.from(new Set(out));
}

function escapeRegexExceptPipe(s) {
  // We accept pipes as alternation; everything else literal.
  return s.replace(/[.*+?^${}()[\]\\]/g, "\\$&");
}

function buildRegex(pattern) {
  // If pattern contains "|" we treat the alternatives as literals.
  if (pattern.includes("|")) {
    const parts = pattern.split("|").map((p) => escapeRegexExceptPipe(p));
    return new RegExp("(" + parts.join("|") + ")", "i");
  }
  return new RegExp(escapeRegexExceptPipe(pattern), "i");
}

function grepRepo(root, patterns) {
  const files = walk(root);
  const fileScores = new Map();
  let rawOutput = "";
  for (const pat of patterns) {
    const re = buildRegex(pat);
    for (const fp of files) {
      let txt;
      try { txt = fs.readFileSync(fp, "utf8"); } catch { continue; }
      const lines = txt.split(/\r?\n/);
      let matches = 0;
      for (let i = 0; i < lines.length && matches < MAX_MATCHES_PER_FILE; i++) {
        if (re.test(lines[i])) {
          matches++;
          rawOutput += `${rel(fp, root)}:${i + 1}:${lines[i]}\n`;
        }
      }
      if (matches > 0) {
        fileScores.set(rel(fp, root), (fileScores.get(rel(fp, root)) || 0) + matches);
      }
    }
  }
  return { rawOutput, fileScores };
}

function locateBaseline(repoRoot, query) {
  const t0 = Date.now();
  const patterns = tokenizeQueryForGrep(query);
  const { rawOutput, fileScores } = grepRepo(repoRoot, patterns);
  const ranked = Array.from(fileScores.entries()).sort((a, b) => b[1] - a[1]).map(([f]) => f);
  let consumed = rawOutput;
  const filesRead = [];
  for (const r of ranked.slice(0, MAX_FILES_READ)) {
    try {
      const txt = fs.readFileSync(path.join(repoRoot, r), "utf8");
      if (txt.length < 6000) {
        consumed += txt;
      } else {
        const lines = txt.split(/\r?\n/);
        const firstMatch = lines.findIndex((l) => patterns.some((p) => buildRegex(p).test(l)));
        const start = Math.max(0, firstMatch - READ_WINDOW / 2);
        const end = Math.min(lines.length, start + READ_WINDOW);
        consumed += lines.slice(start, end).join("\n");
      }
      filesRead.push(r);
    } catch {}
  }
  return {
    top1: ranked[0] || null,
    topk: ranked.slice(0, 3),
    delivered_tokens: estimateTokens(consumed),
    elapsedMs: Date.now() - t0,
    filesRead,
  };
}

function impactBaseline(repoRoot, target) {
  const t0 = Date.now();
  const base = path.basename(target).replace(/\.[a-z]+$/, "");
  const noExt = target.replace(/\.[a-z]+$/, "");
  const patterns = [base, noExt];
  const { rawOutput, fileScores } = grepRepo(repoRoot, patterns);
  // exclude the target itself
  fileScores.delete(target);
  const ranked = Array.from(fileScores.entries()).sort((a, b) => b[1] - a[1]).map(([f]) => f);
  let consumed = rawOutput;
  const filesRead = [];
  for (const r of ranked.slice(0, MAX_FILES_READ)) {
    try {
      const txt = fs.readFileSync(path.join(repoRoot, r), "utf8");
      consumed += txt.length < 6000 ? txt : txt.slice(0, 6000);
      filesRead.push(r);
    } catch {}
  }
  return {
    impact: ranked.slice(0, 12),
    delivered_tokens: estimateTokens(consumed),
    elapsedMs: Date.now() - t0,
    filesRead,
  };
}

module.exports = { locateBaseline, impactBaseline };
