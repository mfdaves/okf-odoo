"use strict";

// The replay tests answer from recordings, so they cannot notice Odoo
// renaming a field, changing its type, or the reader changing what it asks
// for. This suite is the oracle for that: it runs against a live server
// started by scripts/live-odoo.sh and compares it with the committed fixture
// for the same major version.

const assert = require("node:assert/strict");
const test = require("node:test");
const { FIELDS, readCatalog } = require("../src/catalog");
const { OdooError, createOdooClient } = require("../src/odoo");
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

function client() {
  return createOdooClient({
    url: process.env.OKF_ODOO_URL,
    database: process.env.OKF_ODOO_DATABASE,
    apiKey: process.env.OKF_ODOO_API_KEY,
  });
}

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
  const fixture = loadFixture(process.env.OKF_ODOO_VERSION);
  const live = client();
  const failures = [];
  for (const model of Object.keys(FIELDS).sort()) {
    let described = null;
    try {
      described = await live.fieldsGet(model, ["type"]);
    } catch (error) {
      if (!(error instanceof OdooError) || error.code !== "model_not_found") throw error;
    }
    const recorded = fixture.shapes[model];
    if (!described || !recorded) {
      if (Boolean(described) !== Boolean(recorded)) {
        failures.push(
          `${model}: ${described ? "exists live but not in the fixture" : "missing live"}`,
        );
      }
      continue;
    }
    for (const field of FIELDS[model]) {
      const type = described[field] ? described[field].type : null;
      if (type !== recorded[field]) {
        failures.push(`${model}.${field}: live ${type}, fixture ${recorded[field]}`);
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
