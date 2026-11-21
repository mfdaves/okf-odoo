"use strict";

// Records the JSON-2 responses the catalog reader receives from a live Odoo
// into test/fixtures/odoo-<version>/calls.json, plus the type of every
// allowlisted field, which test/live-shape.test.js compares against a server.
//
//   eval "$(scripts/live-odoo.sh up 19)" && node scripts/record-fixtures.js

const fs = require("node:fs");
const path = require("node:path");
const { ADDON_MODELS, fieldsFor, readCatalog } = require("../src/catalog");
const {
  FIXTURE_OPTIONS,
  VERSIONS,
  callKey,
  fixturePath,
} = require("../test/support/replay-client");
const { liveClient, required } = require("../test/support/live");

async function fieldShapes(client, version) {
  const fields = fieldsFor(version);
  const shapes = {};
  // The server recorded from is a standard Odoo, without addon models.
  for (const model of Object.keys(fields).sort()) {
    if (ADDON_MODELS.includes(model)) continue;
    const described = await client.fieldsGet(model, ["type"]);
    shapes[model] = Object.fromEntries(
      fields[model].map((field) => [field, described[field] ? described[field].type : null]),
    );
  }
  return shapes;
}

function serialize(fixture) {
  const lines = ["{"];
  lines.push(`  "odoo": ${JSON.stringify(fixture.odoo)},`);
  lines.push(`  "options": ${JSON.stringify(fixture.options)},`);
  lines.push(`  "shapes": {`);
  const shapeEntries = Object.entries(fixture.shapes);
  shapeEntries.forEach(([model, shape], index) => {
    const comma = index < shapeEntries.length - 1 ? "," : "";
    lines.push(`    ${JSON.stringify(model)}: ${JSON.stringify(shape)}${comma}`);
  });
  lines.push("  },");
  lines.push(`  "calls": [`);
  fixture.calls.forEach((call, index) => {
    lines.push("    {");
    lines.push(`      "model": ${JSON.stringify(call.model)},`);
    lines.push(`      "params": ${JSON.stringify(call.params)},`);
    lines.push(`      "rows": [`);
    call.rows.forEach((row, rowIndex) => {
      lines.push(`        ${JSON.stringify(row)}${rowIndex < call.rows.length - 1 ? "," : ""}`);
    });
    lines.push("      ]");
    lines.push(`    }${index < fixture.calls.length - 1 ? "," : ""}`);
  });
  lines.push("  ]");
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

async function record() {
  const version = required("OKF_ODOO_VERSION");
  if (!VERSIONS.includes(version)) throw new Error(`Unsupported Odoo version ${version}.`);
  const client = liveClient();
  const calls = new Map();
  const recorder = {
    async searchRead(model, params) {
      const rows = await client.searchRead(model, params);
      calls.set(callKey(model, params), { model, params, rows });
      return rows;
    },
  };
  const catalog = await readCatalog(recorder, FIXTURE_OPTIONS);
  if (catalog.odooVersion !== version) {
    throw new Error(`The server runs Odoo ${catalog.odooVersion}, not ${version}.`);
  }
  const fixture = {
    odoo: version,
    options: FIXTURE_OPTIONS,
    shapes: await fieldShapes(client, version),
    calls: [...calls.entries()]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([, call]) => call),
  };
  const target = fixturePath(version);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, serialize(fixture), "utf8");
  const rows = fixture.calls.reduce((total, call) => total + call.rows.length, 0);
  process.stdout.write(`${target}: ${fixture.calls.length} calls, ${rows} rows\n`);
}

record().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
