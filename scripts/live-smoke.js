"use strict";

// Publishes a live Odoo's catalog through the okf-mcp command line exactly as
// a project would: the package is linked into the project's node_modules and
// `okf producer preview` and `okf producer run` load it by its bare name.
// Then checks that a second run is unchanged, that okf validate accepts the
// project, and that a key without Settings rights fails on the section it
// cannot read. Start the server with scripts/live-odoo.sh first.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { CatalogError } = require("../src/catalog");
const { generateOdoo } = require("../src/producer");
const { MCP_CLI, PROJECT_RELATION_TYPES } = require("../test/support/okf-mcp");

const REPOSITORY = path.resolve(__dirname, "..");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; start the server with scripts/live-odoo.sh.`);
  return value;
}

function okf(projectPath, args, env) {
  const started = process.hrtime.bigint();
  const run = spawnSync(process.execPath, [MCP_CLI, "--project", projectPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 256 * 1024 * 1024,
  });
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  let receipt = null;
  try {
    receipt = JSON.parse(run.stdout);
  } catch {
    receipt = null;
  }
  return { status: run.status, receipt, stderr: run.stderr, seconds };
}

function projectYaml(url, database) {
  return [
    "project: Odoo live smoke",
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
    `      database: ${database}`,
    "      apiKeyEnv: ODOO_API_KEY",
    "      source: live-odoo",
    "      sections: [modules, models, access, groups, menus, crons, reports, serverActions]",
    "",
  ].join("\n");
}

function read(bundleRoot, file) {
  return fs.readFileSync(path.join(bundleRoot, file), "utf8");
}

async function limitedKeyFailsOnItsSection(url, database) {
  const limitedKey = process.env.OKF_ODOO_LIMITED_API_KEY;
  if (!limitedKey) return null;
  const context = (sections) => ({
    bundleId: "erp",
    config: { url, database, apiKeyEnv: "ODOO_API_KEY", source: "live-odoo", sections },
    getSecret: () => limitedKey,
  });
  // Access Rights (group_erp_manager) can read everything but menus, jobs and
  // server actions; menus are the first of those in reading order.
  await assert.rejects(generateOdoo(context(undefined)), (error) => {
    assert.ok(error instanceof CatalogError, String(error));
    assert.equal(error.code, "access_denied");
    assert.equal(error.section, "menus");
    return true;
  });
  for (const section of ["crons", "serverActions"]) {
    await assert.rejects(
      generateOdoo(context(["models", section])),
      (error) => error.code === "access_denied" && error.section === section,
    );
  }
  const readable = await generateOdoo(
    context(["modules", "models", "access", "groups", "reports"]),
  );
  return readable.summary;
}

async function liveSmoke() {
  if (process.env.OKF_ODOO_LIVE_TEST !== "1") {
    throw new Error(
      "Set OKF_ODOO_LIVE_TEST=1 to read the disposable Odoo of scripts/live-odoo.sh.",
    );
  }
  const url = required("OKF_ODOO_URL");
  const database = required("OKF_ODOO_DATABASE");
  const apiKey = required("OKF_ODOO_API_KEY");
  const version = required("OKF_ODOO_VERSION");
  if (!fs.existsSync(MCP_CLI))
    throw new Error(`The sibling okf-mcp checkout is required: ${MCP_CLI}`);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-odoo-live-"));
  try {
    const scope = path.join(root, "node_modules", "@mfdaves");
    fs.mkdirSync(scope, { recursive: true });
    fs.symlinkSync(REPOSITORY, path.join(scope, "okf-odoo"), "dir");
    const bundleRoot = path.join(root, "okf", "erp");
    fs.mkdirSync(bundleRoot, { recursive: true });
    const projectPath = path.join(root, "okf.project.yaml");
    fs.writeFileSync(projectPath, projectYaml(url, database), "utf8");
    const env = { ODOO_API_KEY: apiKey };

    const preview = okf(projectPath, ["producer", "preview", "odoo"], env);
    assert.equal(preview.status, 0, preview.stderr || JSON.stringify(preview.receipt?.diagnostics));
    assert.equal(preview.receipt.readyToApply, true);
    assert.deepEqual(fs.readdirSync(bundleRoot), []);

    const writeArgs = ["producer", "run", "odoo", "--write", "--actor", "process:okf-odoo-live"];
    const first = okf(projectPath, writeArgs, env);
    assert.equal(first.status, 0, first.stderr || JSON.stringify(first.receipt?.diagnostics));
    assert.equal(first.receipt.applied, true);
    const files = first.receipt.counts.create;
    assert.equal(files, first.receipt.summary.files);

    const second = okf(projectPath, writeArgs, env);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(second.receipt.counts, { create: 0, update: 0, delete: 0, unchanged: files });

    const validation = okf(projectPath, ["validate"], {});
    assert.equal(validation.status, 0, JSON.stringify(validation.receipt?.diagnostics));
    assert.equal(validation.receipt.valid, true);

    const order = read(bundleRoot, "models/sale.order.md");
    assert.match(order, /type: defined_in\n {4}target: okf:\/\/erp\/modules\/sale\n/);
    assert.match(order, /<code>partner_id<\/code> \| Customer \| <code>many2one<\/code>/);
    assert.match(order, /## Access\n/);
    const partner = read(bundleRoot, "models/res.partner.md");
    assert.match(partner, /type: extended_by\n {4}target: okf:\/\/erp\/modules\/sale\n/);
    assert.match(read(bundleRoot, "modules/sale.md"), /Models defined[\s\S]*sale\.order\.md/);
    assert.match(read(bundleRoot, "groups/sales_team.group_sale_manager.md"), /type: implies/);
    assert.match(read(bundleRoot, "apps/base.menu_administration.md"), /type: opens/);
    for (const file of fs.readdirSync(bundleRoot, { recursive: true })) {
      const target = path.join(bundleRoot, file);
      if (fs.statSync(target).isFile()) {
        const content = fs.readFileSync(target, "utf8");
        assert.equal(content.includes(apiKey), false, file);
        assert.equal(content.includes(url), false, file);
      }
    }

    const limited = await limitedKeyFailsOnItsSection(url, database);
    process.stdout.write(
      `${JSON.stringify(
        {
          odoo: version,
          summary: first.receipt.summary,
          firstRun: { counts: first.receipt.counts, seconds: Number(first.seconds.toFixed(2)) },
          secondRun: { counts: second.receipt.counts, seconds: Number(second.seconds.toFixed(2)) },
          previewSeconds: Number(preview.seconds.toFixed(2)),
          validated: true,
          limitedKey: limited,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

liveSmoke().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
