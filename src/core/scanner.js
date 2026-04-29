// @cm-file domain=core/scanner exports=scanRepo,defaultIgnores role=walk-tracked-files
const fs = require("fs");
const path = require("path");
const { toPosix } = require("./paths");

const DEFAULT_IGNORES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".cache",
  ".turbo",
  ".parcel-cache",
  ".vite",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".tox",
  "target",
  "vendor",
  ".idea",
  ".vscode-test",
  ".ai-context",
  ".code-map",
]);

const TEXT_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts",
  ".cs", ".cpp", ".cc", ".c", ".h", ".hpp",
  ".php", ".swift", ".scala", ".sh", ".bash",
  ".json", ".yaml", ".yml", ".toml",
  ".md", ".mdx", ".sql", ".graphql", ".gql",
  ".html", ".css", ".scss", ".vue", ".svelte",
]);

// Source-only extensions for the scan filter mode. Excludes JSON, lockfiles, markdown,
// configs, etc. These dilute the index, inflate search, and waste tokens.
const SOURCE_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts",
  ".cs", ".cpp", ".cc", ".c", ".h", ".hpp",
  ".php", ".swift", ".scala",
  ".vue", ".svelte",
  ".sql", ".graphql", ".gql",
]);

const SCAN_DROP_BASENAMES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
  "Cargo.lock", "Pipfile.lock", "poetry.lock", "go.sum",
]);

function isText(file) {
  if (process.env.CM_SCAN_FILTER === "1") {
    return SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()) && !SCAN_DROP_BASENAMES.has(path.basename(file));
  }
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function* walk(root, ignore) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const name = ent.name;
      if (name.startsWith(".") && !["..", "."].includes(name)) {
        if (ignore.has(name)) continue;
      }
      if (ignore.has(name)) continue;
      const abs = path.join(dir, name);
      if (ent.isDirectory()) {
        stack.push(abs);
      } else if (ent.isFile()) {
        if (isText(name)) yield abs;
      }
    }
  }
}

function scanRepo(root, opts = {}) {
  const ignore = new Set([...DEFAULT_IGNORES, ...(opts.ignore || [])]);
  const out = [];
  for (const abs of walk(root, ignore)) {
    const rel = toPosix(path.relative(root, abs));
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    out.push({ abs, rel, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return out;
}

module.exports = { scanRepo, isText, DEFAULT_IGNORES };
