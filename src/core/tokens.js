// @cm-file domain=core/tokens exports=estimateTokens,countFileTokens role=token-accounting
// Lightweight token estimator - approximates GPT/Claude tokenizers without external deps.
// Heuristic: 1 token per 3.6 chars for code, with bonuses for whitespace runs and newlines.
const fs = require("fs");

function estimateTokens(text) {
  if (!text) return 0;
  const len = text.length;
  // Slight code-bias factor: code averages ~3.6 chars/token across mainstream tokenizers.
  const base = Math.ceil(len / 3.6);
  // Newlines and long indentation runs collapse cheaply, so subtract a small share.
  const newlines = (text.match(/\n/g) || []).length;
  return Math.max(1, base - Math.floor(newlines * 0.15));
}

function countFileTokens(absPath) {
  try {
    const text = fs.readFileSync(absPath, "utf8");
    return estimateTokens(text);
  } catch {
    return 0;
  }
}

module.exports = { estimateTokens, countFileTokens };
