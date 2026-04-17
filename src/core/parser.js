// @cm-file domain=core/parser exports=parseFile role=symbol+route+test+import-extractor
// Regex-based extractor for JS/TS/Python/Go/Rust/Java/etc. Pragmatic, not a full AST.
// Extracts: symbols (functions, classes, methods, exports), imports/requires, route declarations,
// test cases, and inferred role (entry/test/route/migration/schema/config).
const path = require("path");
const { parseAnchors } = require("./anchors");

const TEST_HINT = /\b(test|spec|__tests__|tests?\/)\b/i;
const ROUTE_HINT = /\b(routes?|controllers?|handlers?|endpoints?|api)\b/i;
const MIGRATION_HINT = /\b(migrations?|schemas?)\b/i;
const CONFIG_HINT = /\b(config|settings|env)\b/i;

function fileRole(rel) {
  if (TEST_HINT.test(rel)) return "test";
  if (MIGRATION_HINT.test(rel)) return "schema";
  if (ROUTE_HINT.test(rel)) return "route";
  if (CONFIG_HINT.test(rel)) return "config";
  return "module";
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function safeAdd(set, v) {
  if (v && typeof v === "string") set.add(v);
}

function extractJSImports(text) {
  const out = [];
  const re1 = /\bimport\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g;
  const re2 = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
  const re3 = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re1.exec(text)) !== null) out.push(m[1]);
  while ((m = re2.exec(text)) !== null) out.push(m[1]);
  while ((m = re3.exec(text)) !== null) out.push(m[1]);
  return uniq(out);
}

function extractPyImports(text) {
  const out = [];
  const re1 = /^\s*from\s+([\w\.]+)\s+import\b/gm;
  const re2 = /^\s*import\s+([\w\.]+)/gm;
  let m;
  while ((m = re1.exec(text)) !== null) out.push(m[1]);
  while ((m = re2.exec(text)) !== null) out.push(m[1]);
  return uniq(out);
}

function extractGoImports(text) {
  const out = [];
  const block = /import\s*\(([\s\S]*?)\)/g;
  let m;
  while ((m = block.exec(text)) !== null) {
    const lines = m[1].split(/\r?\n/);
    for (const l of lines) {
      const mm = l.match(/"([^"]+)"/);
      if (mm) out.push(mm[1]);
    }
  }
  const single = /^\s*import\s+"([^"]+)"/gm;
  while ((m = single.exec(text)) !== null) out.push(m[1]);
  return uniq(out);
}

function extractRustImports(text) {
  const out = [];
  const re = /^\s*use\s+([\w:]+)/gm;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return uniq(out);
}

function extractImports(rel, text) {
  const ext = path.extname(rel).toLowerCase();
  if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".vue", ".svelte"].includes(ext)) return extractJSImports(text);
  if (ext === ".py") return extractPyImports(text);
  if (ext === ".go") return extractGoImports(text);
  if (ext === ".rs") return extractRustImports(text);
  return [];
}

function extractJSSymbols(text, lines) {
  const symbols = [];
  const patterns = [
    { kind: "function", re: /^\s*(?:export\s+(?:default\s+)?|async\s+|export\s+async\s+)?function\s+([A-Za-z_$][\w$]*)/gm },
    { kind: "function", re: /^\s*(?:export\s+(?:const|let|var)\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>)/gm },
    { kind: "class", re: /^\s*(?:export\s+(?:default\s+)?)?class\s+([A-Za-z_$][\w$]*)/gm },
    { kind: "method", re: /^\s{2,}(?:async\s+|static\s+|public\s+|private\s+|protected\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm },
  ];
  for (const { kind, re } of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const name = m[1];
      if (!name || ["if", "for", "while", "switch", "return", "function", "constructor"].includes(name)) continue;
      const line = text.slice(0, m.index).split("\n").length;
      symbols.push({ kind, name, line });
    }
  }
  return symbols;
}

function extractPySymbols(text) {
  const symbols = [];
  const re = /^(\s*)(?:async\s+)?(def|class)\s+([A-Za-z_][\w]*)/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const indent = m[1].length;
    const kind = m[2] === "class" ? "class" : indent > 0 ? "method" : "function";
    const line = text.slice(0, m.index).split("\n").length;
    symbols.push({ kind, name: m[3], line });
  }
  return symbols;
}

function extractGoSymbols(text) {
  const symbols = [];
  const fn = /^\s*func\s+(?:\(\s*[^)]+\)\s+)?([A-Za-z_][\w]*)/gm;
  const ty = /^\s*type\s+([A-Za-z_][\w]*)\s+(?:struct|interface)\b/gm;
  let m;
  while ((m = fn.exec(text)) !== null) {
    const line = text.slice(0, m.index).split("\n").length;
    symbols.push({ kind: "function", name: m[1], line });
  }
  while ((m = ty.exec(text)) !== null) {
    const line = text.slice(0, m.index).split("\n").length;
    symbols.push({ kind: "class", name: m[1], line });
  }
  return symbols;
}

function extractRustSymbols(text) {
  const symbols = [];
  const fn = /^\s*(?:pub\s+(?:\([\w:]+\)\s+)?)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/gm;
  const st = /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_][\w]*)/gm;
  let m;
  while ((m = fn.exec(text)) !== null) {
    symbols.push({ kind: "function", name: m[1], line: text.slice(0, m.index).split("\n").length });
  }
  while ((m = st.exec(text)) !== null) {
    symbols.push({ kind: "class", name: m[1], line: text.slice(0, m.index).split("\n").length });
  }
  return symbols;
}

function extractRoutes(rel, text) {
  const routes = [];
  // Express / Koa / Fastify / generic JS frameworks
  const reJs = /\b(?:app|router|api|server|fastify)\s*\.\s*(get|post|put|patch|delete|all|use|options|head)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  // FastAPI / Flask / Django
  const rePy = /@(?:app|router|api_view|api)\.(get|post|put|patch|delete|route)\s*\(\s*["']([^"']+)["']/g;
  const rePyFlask = /@(?:app|bp|blueprint)\.route\s*\(\s*["']([^"']+)["'](?:\s*,\s*methods\s*=\s*\[([^\]]+)\])?/g;
  // Go nethttp / chi
  const reGo = /\b(?:mux|router|r)\s*\.\s*(?:Handle|HandleFunc|Get|Post|Put|Patch|Delete)\s*\(\s*"([^"]+)"/g;
  let m;
  while ((m = reJs.exec(text)) !== null) {
    routes.push({ method: m[1].toUpperCase(), path: m[2], line: text.slice(0, m.index).split("\n").length });
  }
  while ((m = rePy.exec(text)) !== null) {
    routes.push({ method: m[1].toUpperCase(), path: m[2], line: text.slice(0, m.index).split("\n").length });
  }
  while ((m = rePyFlask.exec(text)) !== null) {
    routes.push({ method: (m[2] || "GET").replace(/['"]/g, "").trim().toUpperCase().split(",")[0], path: m[1], line: text.slice(0, m.index).split("\n").length });
  }
  while ((m = reGo.exec(text)) !== null) {
    routes.push({ method: "ANY", path: m[1], line: text.slice(0, m.index).split("\n").length });
  }
  return routes;
}

function extractTests(rel, text) {
  const tests = [];
  const re = /\b(?:it|test|describe|context)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  const rePy = /^\s*def\s+(test_[\w]+)/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    tests.push({ name: m[1], line: text.slice(0, m.index).split("\n").length });
  }
  while ((m = rePy.exec(text)) !== null) {
    tests.push({ name: m[1], line: text.slice(0, m.index).split("\n").length });
  }
  return tests;
}

function extractSymbols(rel, text) {
  const ext = path.extname(rel).toLowerCase();
  const lines = text.split("\n");
  if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"].includes(ext)) return extractJSSymbols(text, lines);
  if (ext === ".py") return extractPySymbols(text);
  if (ext === ".go") return extractGoSymbols(text);
  if (ext === ".rs") return extractRustSymbols(text);
  return [];
}

function parseFile(rel, text) {
  const role = fileRole(rel);
  const anchors = parseAnchors(text);
  const imports = extractImports(rel, text);
  const symbols = extractSymbols(rel, text);
  const routes = extractRoutes(rel, text);
  const tests = role === "test" ? extractTests(rel, text) : [];
  // Collect tokens (identifiers + path segments) for cheap lexical search.
  const idTokens = uniq(
    (text.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || []).slice(0, 800).map((t) => t.toLowerCase())
  );
  return {
    rel,
    role,
    anchors,
    imports,
    symbols,
    routes,
    tests,
    tokens: idTokens,
    lineCount: text.split("\n").length,
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

module.exports = { parseFile, fileRole, extractImports, extractSymbols };
