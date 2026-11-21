"use strict";

// The replay tests answer from recordings, so they cannot notice Odoo
// renaming a field, changing its type, or the reader changing what it asks
// for. This suite is the oracle for that: it runs against a live server
// started by scripts/live-odoo.sh and compares it with the committed fixture
// for the same major version.

const assert = require("node:assert/strict");
const test = require("node:test");
const { ADDON_MODELS, fieldsFor, readCatalog } = require("../src/catalog");
const { liveClient } = require("./support/live");
const { FIXTURE_OPTIONS, callKey, loadFixture } = require("./support/replay-client");

// Record ids differ between databases, so requests are compared with every
// list of ids in their domain replaced by a placeholder.
function requestKey(model, params) {
  const domain = (params.domain || []).map((condition) =>
    condition.map((part) => (Array.isArray(part) && part.every(Number.isInteger) ? "<ids>" : part)),
  );
  return callKey(model, { ...params, domain });
}

const LIVE =
  process.env.OKF_ODOO_LIVE_TEST === "1" &&
  Boolean(process.env.OKF_ODOO_URL && process.env.OKF_ODOO_API_KEY && process.env.OKF_ODOO_VERSION);
const skip = LIVE
  ? false
  : "set OKF_ODOO_LIVE_TEST=1 and the variables scripts/live-odoo.sh prints";

const client = () => liveClient();

// What a reader can branch on: null carries no information.
function shapeOf(value) {
  if (value === null || value === undefined || value === false) return null;
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function rowShapes(rows) {
  const shapes = new Map();
  for (const row of rows) {
    for (const [field, value] of Object.entries(row)) {
      const shape = shapeOf(value);
      if (shape && !shapes.has(field)) shapes.set(field, shape);
    }
  }
  return shapes;
}

test("every allowlisted field exists with the type the fixture recorded", { skip }, async () => {
  const version = process.env.OKF_ODOO_VERSION;
  const fixture = loadFixture(version);
  // The live server is a standard Odoo: an addon's model is not on it.
  const fields = Object.fromEntries(
    Object.entries(fieldsFor(version)).filter(([model]) => !ADDON_MODELS.includes(model)),
  );
  const live = client();
  const failures = [];
  assert.deepEqual(Object.keys(fixture.shapes).sort(), Object.keys(fields).sort());
  for (const model of Object.keys(fields).sort()) {
    const described = await live.fieldsGet(model, ["type"]);
    for (const field of fields[model]) {
      const type = described[field] ? described[field].type : null;
      if (type !== fixture.shapes[model][field]) {
        failures.push(`${model}.${field}: live ${type}, fixture ${fixture.shapes[model][field]}`);
      }
    }
  }
  assert.deepEqual(
    failures,
    [],
    `fixture no longer matches the server:\n  ${failures.join("\n  ")}`,
  );
});

test("the reader makes the recorded requests and receives rows of the recorded shape", {
  skip,
}, async () => {
  const fixture = loadFixture(process.env.OKF_ODOO_VERSION);
  const recorded = new Map(
    fixture.calls.map((call) => [requestKey(call.model, call.params), call]),
  );
  const live = client();
  const failures = [];
  const seen = new Set();
  await readCatalog(
    {
      async searchRead(model, params) {
        const rows = await live.searchRead(model, params);
        const key = requestKey(model, params);
        seen.add(key);
        const call = recorded.get(key);
        if (!call) {
          failures.push(`${model}: request not in the fixture ${JSON.stringify(params)}`);
          return rows;
        }
        const liveShapes = rowShapes(rows);
        const fixtureShapes = rowShapes(call.rows);
        for (const [field, shape] of liveShapes) {
          const expected = fixtureShapes.get(field);
          if (expected && expected !== shape) {
            failures.push(`${model}.${field}: live ${shape}, fixture ${expected}`);
          }
        }
        for (const field of [...(params.fields || []), "id"]) {
          if (rows.length && !rows.some((row) => field in row)) {
            failures.push(`${model}.${field}: requested but absent from live rows`);
          }
        }
        return rows;
      },
    },
    FIXTURE_OPTIONS,
  );
  for (const [key, call] of recorded) {
    if (!seen.has(key)) failures.push(`${call.model}: recorded request no longer made`);
  }
  assert.deepEqual(
    failures,
    [],
    `fixture no longer matches the server:\n  ${failures.join("\n  ")}`,
  );
});
