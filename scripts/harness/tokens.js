// Honest token estimator. Same heuristic for all sides so comparisons are fair.
// 3.6 chars/token is conservative for code (LLM tokenizers run ~3-4 chars/token on source).
// Newlines collapsed at 0.15 of count because tokenizers compress them lightly.
function estimateTokens(text) {
  if (text == null) return 0;
  const s = typeof text === "string" ? text : JSON.stringify(text);
  if (!s) return 0;
  const newlines = (s.match(/\n/g) || []).length;
  return Math.max(1, Math.ceil(s.length / 3.6) - Math.floor(newlines * 0.15));
}
module.exports = { estimateTokens };
