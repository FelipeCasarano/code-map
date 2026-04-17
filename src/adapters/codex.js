// @cm-file domain=adapters/codex exports=manifest role=codex-plugin-shape
// Codex (and Codex-CLI-style harnesses) can shell out to local commands. This adapter exposes the
// same surface as the Claude Code adapter under a Codex-friendly manifest.
const path = require("path");
const { toolDescriptors } = require("./generic");

const manifest = {
  name: "code-map",
  version: require("../../package.json").version,
  description: "Code Map + Context Routing for Codex-style agents.",
  commands: toolDescriptors.map((d) => ({
    name: d.name,
    description: d.description,
    cli: {
      command: "node",
      args: [path.resolve(__dirname, "..", "cli", "index.js"), d.name.replace(/^cm_/, ""), "--json"],
    },
  })),
  bootstrap: {
    command: "node",
    args: [path.resolve(__dirname, "..", "cli", "index.js"), "sync"],
  },
};

if (require.main === module) {
  process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
}

module.exports = { manifest };
