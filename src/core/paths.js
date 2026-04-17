// @cm-file domain=core/paths exports=repoRoot,ctxDir,ensureDir,toPosix tests=tests/paths.test.js
const fs = require("fs");
const path = require("path");

const CTX_DIRNAME = ".code-map";

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function repoRoot(start) {
  let dir = path.resolve(start || process.cwd());
  const { root } = path.parse(dir);
  while (true) {
    if (
      fs.existsSync(path.join(dir, CTX_DIRNAME)) ||
      fs.existsSync(path.join(dir, "package.json")) ||
      fs.existsSync(path.join(dir, ".git"))
    ) {
      return dir;
    }
    if (dir === root) return path.resolve(start || process.cwd());
    dir = path.dirname(dir);
  }
}

function ctxDir(root) {
  return path.join(root || repoRoot(), CTX_DIRNAME);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function relFromRoot(root, abs) {
  return toPosix(path.relative(root, abs));
}

module.exports = { repoRoot, ctxDir, ensureDir, toPosix, relFromRoot, CTX_DIRNAME };
