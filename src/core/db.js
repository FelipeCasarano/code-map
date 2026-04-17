// @cm-file domain=core/storage exports=Store role=jsonl-backed-index tests=tests/db.test.js
const fs = require("fs");
const path = require("path");
const { ctxDir, ensureDir } = require("./paths");

const FILES = {
  index: "index.json",
  symbols: "symbols.jsonl",
  summaries: "summaries.jsonl",
  aliases: "aliases.jsonl",
  graph: "graph.json",
  benchmark: "benchmark.json",
  version: "version.json",
};

class Store {
  constructor(root) {
    this.dir = ctxDir(root);
    ensureDir(this.dir);
    ensureDir(path.join(this.dir, "sessions"));
  }

  _file(name) {
    return path.join(this.dir, FILES[name] || name);
  }

  readJSON(name, fallback = null) {
    const p = this._file(name);
    if (!fs.existsSync(p)) return fallback;
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return fallback;
    }
  }

  writeJSON(name, data) {
    fs.writeFileSync(this._file(name), JSON.stringify(data, null, 2));
  }

  readJSONL(name) {
    const p = this._file(name);
    if (!fs.existsSync(p)) return [];
    return fs
      .readFileSync(p, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  writeJSONL(name, rows) {
    const p = this._file(name);
    fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  }

  appendJSONL(name, row) {
    const p = this._file(name);
    fs.appendFileSync(p, JSON.stringify(row) + "\n");
  }

  exists(name) {
    return fs.existsSync(this._file(name));
  }
}

module.exports = { Store, FILES };
