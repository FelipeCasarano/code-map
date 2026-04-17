// @cm-file domain=adapters/claude-code exports=manifest role=claude-code-plugin-shape
// Claude Code can run any CLI as a tool. This adapter wires the cm CLI into a Claude Code-style
// plugin manifest. Skills under `skills/` are picked up automatically by the harness; this file
// describes the tool surface.
const path = require("path");
const { toolDescriptors } = require("./generic");

const manifest = {
  name: "code-map",
  version: require("../../package.json").version,
  description: "Code Map + Context Routing - resolves, ranks, and predicts impact without re-reading the repo.",
  bin: {
    cm: path.resolve(__dirname, "..", "cli", "index.js"),
  },
  skills: [
    "skills/using-code-map",
    "skills/updating-code-map",
    "skills/measuring-context-savings",
  ],
  tools: toolDescriptors.map((d) => ({
    ...d,
    invoke: { type: "cli", command: "cm", args: [d.name.replace(/^cm_/, ""), "--json"] },
  })),
  hooks: {
    onSessionStart: { type: "cli", command: "cm", args: ["sync"] },
  },
  permissions: {
    filesystem: ["read", "write:.code-map"],
    network: [],
  },
};

if (require.main === module) {
  process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
}

module.exports = { manifest };
