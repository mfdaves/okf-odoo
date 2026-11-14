"use strict";

// Drives the producer through okf-mcp's ProducerService against a fake JSON-2
// server that serves the recorded Odoo 19 and 20 responses: preview writes
// nothing, run publishes, and a second run with a later clock is unchanged.
// Requires the sibling ../okf-mcp checkout.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const producerPackage = require("../src");
const { startFakeOdoo } = require("../test/support/fake-odoo");
const { MCP_CLI, MCP_ROOT, PROJECT_RELATION_TYPES } = require("../test/support/okf-mcp");
const {
  FIXTURE_OPTIONS,
  VERSIONS,
  fixtureHandler,
  loadFixture,
} = require("../test/support/replay-client");

const API_KEY = "mock-smoke-api-key";

function projectYaml(url) {
  return [
    "project: Odoo producer smoke",
    "bundles:",
    "  - id: erp",
    "    root: okf/erp",
    "relationTypes:",
    ...PROJECT_RELATION_TYPES.map((type) => `  - ${type}`),
    "producers:",
    "  - name: odoo",
    "    type: odoo",
    "    package: '@mfdaves/okf-odoo'",
    "    bundle: erp",
    "    config:",
    `      url: ${url}`,
    "      database: okf_live",
    "      apiKeyEnv: ODOO_API_KEY",
    "      source: erp",
    `      sections: [${FIXTURE_OPTIONS.sections.join(", ")}]`,
    "      modules:",
    `        include: [${FIXTURE_OPTIONS.modules.include.join(", ")}]`,
    "",
  ].join("\n");
}

async function smokeVersion(version, mcp) {
  const serve = fixtureHandler(loadFixture(version));
  const server = await startFakeOdoo((request) =>
    request.headers.authorization === `bearer ${API_KEY}` ? serve(request) : { status: 401 },
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `okf-odoo-smoke-${version}-`));
  try {
    const bundleRoot = path.join(root, "okf", "erp");
    fs.mkdirSync(bundleRoot, { recursive: true });
    const projectPath = path.join(root, "okf.project.yaml");
    fs.writeFileSync(projectPath, projectYaml(server.url), "utf8");
    const project = mcp.loadProjectConfig(projectPath);
    assert.deepEqual(project.errors, []);
    const service = (now) =>
      new mcp.ProducerService({
        project,
        store: mcp.FileConceptStore.fromProject(projectPath),
        loader: async () => producerPackage,
        env: { ODOO_API_KEY: API_KEY },
        now: () => new Date(now),
      });

    const preview = await service("2026-11-14T10:00:00.000Z").preview("odoo");
    assert.equal(preview.readyToApply, true, JSON.stringify(preview.diagnostics));
    assert.deepEqual(fs.readdirSync(bundleRoot), []);

    const first = await service("2026-11-14T10:00:00.000Z").run("odoo");
    assert.equal(first.applied, true, JSON.stringify(first.diagnostics));
    assert.equal(first.counts.create, first.files.length);
    assert.ok(fs.existsSync(path.join(bundleRoot, ".okf-producer.json")));

    const second = await service("2026-11-15T10:00:00.000Z").run("odoo");
    assert.equal(second.applied, true, JSON.stringify(second.diagnostics));
    assert.deepEqual(second.counts, {
      create: 0,
      update: 0,
      delete: 0,
      unchanged: first.files.length,
    });

    const validation = spawnSync(
      process.execPath,
      [MCP_CLI, "--project", projectPath, "validate"],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    assert.equal(validation.status, 0, validation.stdout || validation.stderr);
    assert.equal(
      server.requests.every((request) => request.headers["x-odoo-database"] === "okf_live"),
      true,
    );
    return { odoo: version, first: first.counts, second: second.counts, summary: first.summary };
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function smoke() {
  if (!fs.existsSync(MCP_CLI)) {
    throw new Error(`The sibling okf-mcp checkout is required: ${MCP_ROOT}`);
  }
  const mcp = require(path.join(MCP_ROOT, "src"));
  const results = [];
  for (const version of VERSIONS) results.push(await smokeVersion(version, mcp));
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

smoke().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
