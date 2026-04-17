// @cm-file domain=core/anchors exports=parseAnchors role=structured-comment-parser
// Parses short @cm and @cm-file anchors from any source file.
// Anchors stay in code as a navigation hint; richer metadata is stored in the index.

const ANCHOR_LINE = /@cm(?:-file)?\b([^\n]*)/g;

function splitKv(rest) {
  const out = {};
  // Match key=value where value may be a comma-separated bareword list or a quoted string.
  const re = /([a-zA-Z_][a-zA-Z0-9_-]*)=("([^"]*)"|([^\s]+))/g;
  let m;
  while ((m = re.exec(rest)) !== null) {
    const key = m[1];
    const val = m[3] !== undefined ? m[3] : m[4];
    if (val.includes(",")) {
      out[key] = val.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      out[key] = val;
    }
  }
  return out;
}

function parseAnchors(text) {
  const out = { file: null, items: [] };
  if (!text) return out;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fileMatch = line.match(/@cm-file\b([^\n]*)/);
    if (fileMatch) {
      out.file = { line: i + 1, ...splitKv(fileMatch[1]) };
      continue;
    }
    const symMatch = line.match(/@cm\b([^\n]*)/);
    if (symMatch) {
      out.items.push({ line: i + 1, ...splitKv(symMatch[1]) });
    }
  }
  return out;
}

module.exports = { parseAnchors };
