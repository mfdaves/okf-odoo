"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CatalogError } = require("../src/catalog");
const { generateOdoo, odooProducer, okfProducer, validateConfig } = require("../src/producer");
const { startFakeOdoo } = require("./support/fake-odoo");
const { producerHost, siblingAvailable } = require("./support/okf-mcp");
const { FIXTURE_OPTIONS, fixtureHandler, loadFixture } = require("./support/replay-client");

const API_KEY = "fixture-api-key-0123456789";

async function fakeOdoo(t, version, intercept) {
  const serve = fixtureHandler(loadFixture(version));
  const server = await startFakeOdoo(async (request) => {
    if (request.headers.authorization !== `bearer ${API_KEY}`) return { status: 401, body: {} };
    return (intercept && (await intercept(request))) || serve(request);
  });
  t.after(() => server.close());
  return server;
}

function contextFor(server, overrides = {}) {
  const requested = [];
  return {
    requested,
    context: {
      bundleId: "erp",
      generatedAt: "2026-11-14T10:00:00Z",
      config: {
        url: server.url,
        database: "okf_live",
        apiKeyEnv: "ERP_ODOO_KEY",
        source: "erp",
        sections: FIXTURE_OPTIONS.sections,
        modules: FIXTURE_OPTIONS.modules,
        ...overrides,
      },
      getSecret(name) {
        requested.push(name);
        return API_KEY;
      },
    },
  };
}

test("the descriptor declares Producer API v1 for OKF 0.2", () => {
  assert.equal(okfProducer, odooProducer);
  assert.equal(okfProducer.apiVersion, "1");
  assert.equal(okfProducer.okfVersion, "0.2");
  assert.equal(okfProducer.id, "odoo");
  assert.equal(okfProducer.version, require("../package.json").version);
  assert.deepEqual(okfProducer.relationTypes, [
    "defined_in",
    "extended_by",
    "references",
    "implies",
    "opens",
    "depends_on",
  ]);
  assert.ok(Object.isFrozen(okfProducer));
});

test("validateConfig fills defaults for a minimal configuration", () => {
  const result = validateConfig({ url: "https://erp.example.com/", apiKeyEnv: "ODOO_API_KEY" });
  assert.equal(result.valid, true);
  assert.deepEqual(result.config, {
    url: "https://erp.example.com",
    database: null,
    apiKeyEnv: "ODOO_API_KEY",
    source: "odoo",
    lang: "en_US",
    sections: ["modules", "models", "access", "groups", "menus", "crons", "reports"],
    modules: { include: [], exclude: [] },
    otherModules: "summary",
  });
  const full = validateConfig({
    url: "http://127.0.0.1:8069",
    database: "erp-prod",
    apiKeyEnv: "ERP_KEY",
    source: "erp",
    lang: "sr@latin",
    sections: ["serverActions", "models", "groups"],
    modules: { include: ["x_*", "sale", "sale"], exclude: ["x_test"] },
    otherModules: "none",
  });
  assert.equal(full.valid, true, JSON.stringify(full.diagnostics));
  assert.deepEqual(full.config.sections, ["models", "groups", "serverActions"]);
  assert.deepEqual(full.config.modules, { include: ["sale", "x_*"], exclude: ["x_test"] });
});

test("validateConfig reports every invalid key without echoing its value", () => {
  const BASE = { url: "https://erp.example.com", apiKeyEnv: "ODOO_API_KEY" };
  const cases = [
    [{ apiKeyEnv: "ODOO_API_KEY" }, "missing_url", "url"],
    [{ url: "https://erp.example.com" }, "missing_api_key_env", "apiKeyEnv"],
    [{ ...BASE, url: "https://admin:hunter2@erp.example.com" }, "invalid_url", "url"],
    [{ ...BASE, url: "ftp://erp.example.com" }, "invalid_url", "url"],
    [{ ...BASE, database: "a b" }, "invalid_database", "database"],
    [{ ...BASE, apiKeyEnv: "hunter2 key" }, "invalid_api_key_env", "apiKeyEnv"],
    [{ ...BASE, source: "erp/prod" }, "invalid_source", "source"],
    [{ ...BASE, lang: "English" }, "invalid_lang", "lang"],
    [{ ...BASE, sections: [] }, "invalid_sections", "sections"],
    [{ ...BASE, sections: ["views"] }, "invalid_sections", "sections"],
    [{ ...BASE, sections: ["access"] }, "section_requires_models", "sections"],
    [{ ...BASE, modules: ["sale"] }, "invalid_modules", "modules"],
    [{ ...BASE, modules: { include: ["Sale!"] } }, "invalid_module_patterns", "modules.include"],
    [{ ...BASE, modules: { only: ["sale"] } }, "unknown_config_key", "modules.only"],
    [{ ...BASE, otherModules: "full" }, "invalid_other_modules", "otherModules"],
    [{ ...BASE, apiKey: "hunter2" }, "unknown_config_key", "apiKey"],
    [{ ...BASE, standardModules: "summary" }, "unknown_config_key", "standardModules"],
  ];
  for (const [config, code, field] of cases) {
    const result = validateConfig(config);
    assert.equal(result.valid, false, JSON.stringify(config));
    assert.deepEqual(
      result.diagnostics.map((entry) => [entry.code, entry.field]),
      [[code, field]],
      JSON.stringify(config),
    );
    assert.doesNotMatch(JSON.stringify(result.diagnostics), /hunter2/);
  }
  assert.equal(validateConfig([]).valid, false);
  assert.equal(validateConfig("https://erp.example.com").diagnostics[0].code, "invalid_config");
});

test("generate reads the catalog over JSON-2 and returns sorted files without the key", async (t) => {
  const server = await fakeOdoo(t, "20");
  const { context, requested } = contextFor(server);
  const result = await generateOdoo(context);
  assert.deepEqual(requested, ["ERP_ODOO_KEY"]);
  const paths = result.files.map((file) => file.path);
  assert.deepEqual(paths, [...paths].sort());
  assert.ok(paths.includes("index.md") && paths.includes("models/crm.team.md"));
  assert.equal(result.summary.files, result.files.length);
  assert.equal(result.summary.models, 11);
  assert.ok(result.summary.fields > 300 && result.summary.accessEntries > 10);
  assert.equal(JSON.stringify(result).includes(API_KEY), false);
  assert.equal(JSON.stringify(result).includes(server.url), false);
  assert.ok(server.requests.every((request) => request.headers["x-odoo-database"] === "okf_live"));
  assert.ok(server.requests.every((request) => request.url.startsWith("/json/2/")));
  for (const value of Object.values(result.summary)) assert.ok(Number.isSafeInteger(value));
});

test("generate fails with access_denied and the section the key cannot read", async (t) => {
  const server = await fakeOdoo(t, "19", ({ model }) =>
    model === "ir.cron" ? { status: 403, body: { name: "odoo.exceptions.AccessError" } } : null,
  );
  const { context } = contextFor(server);
  await assert.rejects(generateOdoo(context), (error) => {
    assert.ok(error instanceof CatalogError);
    assert.equal(error.code, "access_denied");
    assert.equal(error.section, "crons");
    return true;
  });
});

test("generate refuses an invalid bundle, configuration, secret, or an aborted run", async (t) => {
  const server = await fakeOdoo(t, "19");
  const { context } = contextFor(server);
  await assert.rejects(generateOdoo({ ...context, bundleId: "../x" }), /bundleId/);
  await assert.rejects(
    generateOdoo({ ...context, config: { ...context.config, url: "nope" } }),
    (error) => error.code === "invalid_config" && error.diagnostics[0].field === "url",
  );
  await assert.rejects(generateOdoo({ ...context, getSecret: () => "" }), /ERP_ODOO_KEY is empty/);
  await assert.rejects(generateOdoo({ ...context, getSecret: undefined }), /getSecret/);
  const controller = new AbortController();
  controller.abort(new Error("stopped"));
  await assert.rejects(generateOdoo({ ...context, signal: controller.signal }), /stopped/);
  assert.equal(server.requests.length, 0);
});

test("under okf-mcp the API key variable must be named in the configuration", {
  skip: siblingAvailable() ? false : "requires the sibling ../okf-mcp checkout",
}, async (t) => {
  const server = await fakeOdoo(t, "19");
  const config = {
    url: server.url,
    sections: FIXTURE_OPTIONS.sections,
    modules: FIXTURE_OPTIONS.modules,
  };
  const env = { ODOO_API_KEY: API_KEY, ERP_ODOO_KEY: API_KEY };

  const implicit = producerHost({ config, env });
  t.after(implicit.cleanup);
  assert.deepEqual(implicit.project.errors, []);
  const refused = await implicit.service.preview("odoo");
  assert.equal(refused.valid, false);
  assert.deepEqual(
    refused.diagnostics.map((entry) => [entry.code, entry.field]),
    [["missing_api_key_env", "apiKeyEnv"]],
  );
  assert.equal(server.requests.length, 0);

  const named = producerHost({ config: { ...config, apiKeyEnv: "ERP_ODOO_KEY" }, env });
  t.after(named.cleanup);
  const preview = await named.service.preview("odoo");
  assert.equal(preview.readyToApply, true, JSON.stringify(preview.diagnostics));
  assert.ok(server.requests.length > 0);
});
