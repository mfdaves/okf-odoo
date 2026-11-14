"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// The sibling okf-mcp checkout CI places next to this repository.
const MCP_ROOT = path.resolve(__dirname, "../../../okf-mcp");
const MCP_CLI = path.join(MCP_ROOT, "bin/okf-mcp.js");
const PROJECT_RELATION_TYPES = ["defined_in", "extended_by", "references", "implies", "opens"];

function siblingAvailable() {
  return fs.existsSync(MCP_CLI);
}

function writeFiles(root, files) {
  for (const [file, content] of files) {
    const target = path.join(root, ...file.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
}

// Writes the bundle into a project that declares the producer's relation types
// with strict links, and runs `okf validate` on it.
function validateWithOkfMcp(files, bundle = "erp") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-odoo-validate-"));
  try {
    writeFiles(path.join(root, "okf", bundle), files);
    const project = path.join(root, "okf.project.yaml");
    fs.writeFileSync(
      project,
      [
        "project: okf-odoo validation",
        "strictLinks: true",
        "bundles:",
        `  - id: ${bundle}`,
        `    root: okf/${bundle}`,
        "relationTypes:",
        ...PROJECT_RELATION_TYPES.map((type) => `  - ${type}`),
        "",
      ].join("\n"),
    );
    const run = spawnSync(process.execPath, [MCP_CLI, "--project", project, "validate"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    let result = null;
    try {
      result = JSON.parse(run.stdout);
    } catch {
      result = null;
    }
    return { status: run.status, result, stderr: run.stderr };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = {
  MCP_CLI,
  MCP_ROOT,
  PROJECT_RELATION_TYPES,
  siblingAvailable,
  validateWithOkfMcp,
  writeFiles,
};
