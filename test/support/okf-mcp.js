"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const yaml = require("js-yaml");

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

// A project with one `odoo` producer for the given config, served by okf-mcp's
// ProducerService with this package as the loaded producer.
function producerHost({ config, env, now = "2026-11-14T10:00:00.000Z" }) {
  const mcp = require(path.join(MCP_ROOT, "src"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-odoo-host-"));
  const bundleRoot = path.join(root, "okf", "erp");
  fs.mkdirSync(bundleRoot, { recursive: true });
  const projectPath = path.join(root, "okf.project.yaml");
  fs.writeFileSync(
    projectPath,
    yaml.dump({
      project: "okf-odoo host",
      bundles: [{ id: "erp", root: "okf/erp" }],
      relationTypes: PROJECT_RELATION_TYPES,
      producers: [
        { name: "odoo", type: "odoo", package: "@mfdaves/okf-odoo", bundle: "erp", config },
      ],
    }),
  );
  const project = mcp.loadProjectConfig(projectPath);
  const service = new mcp.ProducerService({
    project,
    store: mcp.FileConceptStore.fromProject(projectPath),
    loader: async () => require("../../src"),
    env,
    now: () => new Date(now),
  });
  return {
    project,
    service,
    bundleRoot,
    projectPath,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

module.exports = {
  MCP_CLI,
  MCP_ROOT,
  PROJECT_RELATION_TYPES,
  producerHost,
  siblingAvailable,
  validateWithOkfMcp,
  writeFiles,
};
