// @cm-file domain=tests/runner role=zero-dep-test-runner
const path = require("path");
const fs = require("fs");

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error("Assertion failed: " + (msg || "")); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`Expected ${JSON.stringify(b)} got ${JSON.stringify(a)} (${msg || ""})`); }

const FIXTURE = path.join(__dirname, "fixtures", "sample-project");
const tmpRoot = path.join(__dirname, "..", ".tmp-test-root");

function setupFixture() {
  // Copy fixture to a tmp directory so .code-map lives outside the repo.
  if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  copyDir(FIXTURE, tmpRoot);
  return tmpRoot;
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

const cm = require("../src/core");

test("sync builds an index", () => {
  const root = setupFixture();
  const r = cm.cm_sync({ root });
  assert(r.fileCount >= 6, "expected fixture files indexed: " + r.fileCount);
  assert(r.symbolCount > 0, "expected symbols");
});

test("resolve finds a file by basename", () => {
  const root = tmpRoot;
  const r = cm.cm_resolve("login.js", { root });
  assert(r.ok, "should resolve");
  assert(r.hits[0].rel.endsWith("login.js"), "first hit should be login.js: " + r.hits[0].rel);
});

test("resolve finds a symbol exact name", () => {
  const r = cm.cm_resolve("login", { root: tmpRoot });
  assert(r.ok, "should resolve symbol");
  const top = r.hits.find((h) => h.kind === "function" || h.kind === "symbol" || h.kind === "method");
  assert(top, "expected a symbol-kind hit");
});

test("resolve finds a route literal", () => {
  const r = cm.cm_resolve("POST /login", { root: tmpRoot });
  assert(r.ok && r.hits.some((h) => h.kind === "route"), "expected route hit");
});

test("search returns ranked summaries", () => {
  const r = cm.cm_search("login password", { root: tmpRoot });
  assert(r.ok && r.hits.length > 0, "expected search hits");
});

test("neighbors finds an imported file", () => {
  const r = cm.cm_neighbors("src/auth/login.js", { root: tmpRoot });
  assert(r.ok, "neighbors ok");
  const refs = r.neighbors.map((n) => n.node && n.node.key);
  assert(refs.some((k) => k && k.includes("userRepo.js")), "expected userRepo neighbor");
});

test("impact spans transitively", () => {
  const r = cm.cm_impact("src/utils/jwt.js", { root: tmpRoot });
  assert(r.ok && r.files.length > 0, "expected impact files");
  const rels = r.files.map((f) => f.rel);
  assert(rels.some((p) => p.endsWith("auth/login.js")), "expected login.js in impact");
});

test("explain composes resolver + search + impact", () => {
  const r = cm.cm_explain("login.js", { root: tmpRoot });
  assert(r.resolver && r.resolver.ok, "explain.resolver ok");
});

test("stats records events", () => {
  const r = cm.cm_stats({ root: tmpRoot });
  assert(r.summary.events > 0, "expected recorded events: " + JSON.stringify(r.summary));
});

let pass = 0, fail = 0;
for (const c of cases) {
  try {
    c.fn();
    pass++;
    console.log("PASS  " + c.name);
  } catch (e) {
    fail++;
    console.log("FAIL  " + c.name + "\n      " + e.message);
  }
}
console.log(`\n${pass}/${cases.length} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
