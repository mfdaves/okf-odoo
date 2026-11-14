"use strict";

const fs = require("node:fs");
const path = require("node:path");

// The options the fixtures were recorded with (scripts/record-fixtures.js): every
// section, and a small module selection so the recorded field rows stay small.
const FIXTURE_OPTIONS = Object.freeze({
  sections: ["modules", "models", "access", "groups", "menus", "crons", "reports", "serverActions"],
  modules: { include: ["sales_team", "utm"], exclude: [] },
  otherModules: "summary",
  lang: "en_US",
});

const VERSIONS = Object.freeze(["19", "20"]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function callKey(model, params) {
  const { domain = [], fields = [], context = {} } = params || {};
  return canonical({ model, domain, fields, context });
}

function requestKey(model, params) {
  const { fields = [], context = {} } = params || {};
  return canonical({ model, fields, context });
}

function rowValue(row, field) {
  const value = row[field];
  return Array.isArray(value) ? value[0] : value;
}

// A request matches a recording when its domain is the recorded one, or
// narrows a recorded `in` condition to a subset; the rows are then filtered
// on that field, which must have been read.
function narrow(requested, recorded, rows) {
  if (requested.length !== recorded.length) return null;
  let result = rows;
  for (let index = 0; index < requested.length; index += 1) {
    const [field, operator, value] = requested[index];
    const [recordedField, recordedOperator, recordedValue] = recorded[index];
    if (canonical(requested[index]) === canonical(recorded[index])) continue;
    if (
      field !== recordedField ||
      operator !== "in" ||
      recordedOperator !== "in" ||
      !value.every((entry) => recordedValue.includes(entry)) ||
      !rows.every((row) => field in row)
    ) {
      return null;
    }
    const allowed = new Set(value);
    result = result.filter((row) => allowed.has(rowValue(row, field)));
  }
  return result;
}

function fixturePath(version) {
  return path.join(__dirname, `../fixtures/odoo-${version}/calls.json`);
}

function loadFixture(version) {
  return JSON.parse(fs.readFileSync(fixturePath(version), "utf8"));
}

// Answers searchRead from recorded responses and fails on any call that was
// not recorded, so a reader change that alters a request is caught.
class ReplayClient {
  constructor(fixture, transform) {
    this.recordings = new Map();
    for (const call of fixture.calls) {
      const key = requestKey(call.model, call.params);
      if (!this.recordings.has(key)) this.recordings.set(key, []);
      this.recordings.get(key).push({ domain: call.params.domain || [], rows: call.rows });
    }
    this.transform = transform || ((_model, rows) => rows);
    this.calls = [];
  }

  static forVersion(version, transform) {
    return new ReplayClient(loadFixture(version), transform);
  }

  async searchRead(model, params) {
    this.calls.push({ model, params: structuredClone(params) });
    for (const recording of this.recordings.get(requestKey(model, params)) || []) {
      const rows = narrow(params.domain || [], recording.domain, recording.rows);
      if (rows) return this.transform(model, structuredClone(rows), params);
    }
    throw new Error(`No recorded response for ${model} ${JSON.stringify(params)}`);
  }
}

// A fake JSON-2 handler serving the same recordings page by page.
function fixtureHandler(fixture) {
  const client = new ReplayClient(fixture);
  return async ({ model, method, params }) => {
    if (method !== "search_read") return { status: 404, body: { name: "NotFound" } };
    const { offset = 0, limit, order, ...rest } = params || {};
    let rows;
    try {
      rows = await client.searchRead(model, rest);
    } catch {
      return { status: 500, body: { name: "unrecorded call" } };
    }
    return limit ? rows.slice(offset, offset + limit) : rows.slice(offset);
  };
}

module.exports = {
  FIXTURE_OPTIONS,
  ReplayClient,
  VERSIONS,
  callKey,
  canonical,
  fixtureHandler,
  fixturePath,
  loadFixture,
};
