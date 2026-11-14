"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { okfProducer } = require("../src");
const { okfToolPack: exported } = require("../src");
const { createOdooToolPack, okfToolPack } = require("../src/tool-pack");

// Sentinels that must never appear in a result, an error or the console.
const TOKEN = "SENTINEL-subject-token-4f1d";
const CLIENT_ID = "rs client+id:1é";
const CLIENT_SECRET = "SENTINEL secret/+&=:%";
const ENV = { O3P_CLIENT_ID: CLIENT_ID, O3P_CLIENT_SECRET: CLIENT_SECRET };
const NAMES = [
  "odoo_find_models",
  "odoo_describe_model",
  "odoo_search",
  "odoo_read",
  "odoo_group",
  "odoo_sql",
];

// A stand-in for the o3p_mcp data API. `reply(request)` returns
// { status, body, contentType } or a function that writes the raw response.
async function fakeDataApi(t, reply) {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
      const entry = { method: request.method, url: request.url, headers: request.headers, body };
      requests.push(entry);
      const answer = await reply(entry);
      if (answer === undefined) return;
      if (typeof answer === "function") return answer(response);
      const contentType = answer.contentType || "application/json; charset=utf-8";
      response.writeHead(answer.status || 200, {
        "Content-Type": contentType,
        ...(answer.headers || {}),
      });
      response.end(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

function context(url, extra = {}) {
  return {
    principal: {
      subject: "42",
      actor: "human:someone",
      scopes: new Set(["okf.read", "odoo.read"]),
    },
    subjectToken: TOKEN,
    config: { url, clientIdEnv: "O3P_CLIENT_ID", clientSecretEnv: "O3P_CLIENT_SECRET" },
    getSecret: (name) => ENV[name],
    signal: new AbortController().signal,
    ...extra,
  };
}

const ARGS = {
  odoo_find_models: { query: "partner", limit: 5 },
  odoo_describe_model: { model: "res.partner" },
  odoo_search: {
    model: "sale.order",
    domain: ["|", ["state", "=", "sale"], ["amount_total", ">", 1000]],
    fields: ["name", "partner_id"],
    order: "date_order desc, id",
    limit: 10,
    offset: 20,
  },
  odoo_read: { model: "sale.order", ids: [1, 2], fields: ["name"] },
  odoo_group: {
    model: "sale.order",
    domain: [["state", "=", "sale"]],
    groupby: ["partner_id", "date_order:month"],
    aggregates: ["amount_total:sum", "__count"],
    order: "amount_total:sum desc",
    limit: 20,
  },
  odoo_sql: {
    query:
      "SELECT p.name, count(o.id) FROM res_partner p JOIN sale_order o ON o.partner_id = p.id GROUP BY p.name",
    limit: 5,
  },
};

const RESULTS = {
  models: [{ model: "res.partner", name: "Contact" }],
  describe: { model: "res.partner", name: "Contact", fields: [{ name: "name", type: "char" }] },
  search: { records: [{ id: 1, name: "S1" }], count: 1, truncated: false },
  read: { records: [{ id: 1, name: "S1" }] },
  group: { groups: [{ partner_id: [3, "P"], amount_total: 10, __count: 1 }] },
  sql: {
    columns: [
      { name: "name", type: "character varying" },
      { name: "count", type: "bigint" },
    ],
    rows: [["P", 2]],
    truncated: false,
    elapsedMs: 41,
    tables: [
      { name: "res_partner", model: "res.partner", rows: 12 },
      { name: "sale_order", model: "sale.order", rows: 3 },
    ],
  },
};

function rejectsWith(promise, code) {
  return assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `${error.code} ${error.message}`);
    assert.doesNotMatch(JSON.stringify({ ...error, message: error.message }), /SENTINEL/);
    return true;
  });
}

test("the pack declares API v1, id odoo and six read-only tools", () => {
  assert.equal(exported, okfToolPack);
  assert.ok(okfProducer, "the producer is still exported next to the pack");
  assert.equal(okfToolPack.apiVersion, "1");
  assert.equal(okfToolPack.id, "odoo");
  assert.equal(typeof okfToolPack.validateConfig, "function");
  assert.deepEqual(Object.keys(okfToolPack.tools), NAMES);
  for (const [name, tool] of Object.entries(okfToolPack.tools)) {
    assert.match(name, /^[a-z][a-z0-9_]{2,63}$/);
    assert.equal(tool.scope, name === "odoo_sql" ? "odoo.sql" : "odoo.read");
    assert.equal(tool.requiresSubjectToken, true);
    assert.equal(typeof tool.handler, "function");
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.outputSchema.type, "object");
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.ok(tool.description.length > 100 && tool.description.length < 2500, name);
  }
  const { odoo_search: search, odoo_group: group, odoo_read: read } = okfToolPack.tools;
  assert.match(search.description, /`odoo` knowledge bundle/);
  assert.match(search.description, /odoo_describe_model/);
  assert.match(search.description, /\[\["state", "=", "done"\]/);
  assert.match(search.description, /\["\|", \["name", "ilike"/);
  assert.match(search.description, /signed-in user/);
  assert.match(group.description, /"amount_total:sum"/);
  assert.match(group.description, /"__count"/);
  assert.match(group.description, /only the records the user may read/);
  assert.match(read.description, /odoo_describe_model/);
  assert.match(read.description, /silently left out/);
  assert.match(search.description, /child_of and parent_of are not available/);
  for (const name of ["odoo_search", "odoo_read", "odoo_group", "odoo_sql"]) {
    assert.match(
      okfToolPack.tools[name].description,
      /readable by every MCP user: record conclusions and aggregates, not personal or confidential values/,
      name,
    );
  }
  for (const name of ["odoo_find_models", "odoo_describe_model"]) {
    assert.doesNotMatch(okfToolPack.tools[name].description, /readable by every MCP user/, name);
  }
  assert.match(search.description, /related record's display name/);
  assert.match(search.description, /refused with invalid_params/);
  assert.doesNotMatch(JSON.stringify(search.inputSchema), /child_of|parent_of/);
  assert.match(search.description, /at most 4 fields/);
  assert.match(group.description, /at most 4 fields/);
  assert.match(group.description, /\[id, display name\], a date bucket as \[start, label\]/);
  assert.doesNotMatch(
    group.description + JSON.stringify(group.inputSchema),
    /bool_and|bool_or|array_agg/,
  );
});

test("each tool posts its operation with Basic client credentials and the subject token", async (t) => {
  const server = await fakeDataApi(t, ({ url }) => ({
    body: { result: RESULTS[url.split("/").pop()] },
  }));
  const results = {};
  for (const name of NAMES) {
    results[name] = await okfToolPack.tools[name].handler(ARGS[name], context(server.url));
  }
  assert.deepEqual(
    server.requests.map((request) => [request.method, request.url]),
    ["models", "describe", "search", "read", "group", "sql"].map((op) => [
      "POST",
      `/o3p_mcp/api/v1/${op}`,
    ]),
  );
  for (const request of server.requests) {
    assert.match(request.headers["content-type"], /^application\/json/);
    const [scheme, encoded] = request.headers.authorization.split(" ");
    assert.equal(scheme, "Basic");
    // RFC 6749 2.3.1: each part form-urlencoded, then joined and base64-encoded.
    const [id, secret] = Buffer.from(encoded, "base64").toString("utf8").split(":");
    const decode = (part) => decodeURIComponent(part.replace(/\+/g, " "));
    assert.equal(decode(id), CLIENT_ID);
    assert.equal(decode(secret), CLIENT_SECRET);
    assert.equal(request.body.token, TOKEN);
    assert.deepEqual(Object.keys(request.body).sort(), ["params", "token"]);
  }
  const params = server.requests.map((request) => request.body.params);
  assert.deepEqual(params[0], ARGS.odoo_find_models);
  assert.deepEqual(params[1], ARGS.odoo_describe_model);
  assert.deepEqual(params[2], ARGS.odoo_search);
  assert.deepEqual(params[3], ARGS.odoo_read);
  assert.deepEqual(params[4], ARGS.odoo_group);
  assert.deepEqual(params[5], ARGS.odoo_sql);
  assert.deepEqual(results.odoo_sql, RESULTS.sql);
  assert.deepEqual(results.odoo_find_models, { models: RESULTS.models });
  assert.deepEqual(results.odoo_search, RESULTS.search);
  assert.deepEqual(results.odoo_group, RESULTS.group);
  assert.doesNotMatch(JSON.stringify(results), /SENTINEL/);
});

test("search and group default to an empty domain and a limit of 80", async (t) => {
  const server = await fakeDataApi(t, ({ url }) => ({
    body: { result: RESULTS[url.split("/").pop()] },
  }));
  await okfToolPack.tools.odoo_search.handler(
    { model: "res.partner", fields: ["name"] },
    context(server.url),
  );
  await okfToolPack.tools.odoo_group.handler(
    { model: "res.partner", groupby: ["country_id"], aggregates: ["__count"] },
    context(server.url),
  );
  assert.deepEqual(server.requests[0].body.params, {
    domain: [],
    limit: 80,
    model: "res.partner",
    fields: ["name"],
  });
  assert.deepEqual(server.requests[1].body.params.domain, []);
  assert.equal(server.requests[1].body.params.limit, 80);
});

test("every data API error code becomes the same bounded code, without Odoo's text", async (t) => {
  const contract = [
    [400, "invalid_params"],
    [401, "invalid_client"],
    [403, "invalid_token"],
    [403, "insufficient_scope"],
    [403, "access_denied"],
    [404, "unknown_op"],
    [404, "unknown_model"],
    [413, "result_too_large"],
    [422, "query_error"],
    [504, "timeout"],
  ];
  let next = null;
  const server = await fakeDataApi(t, () => next);
  for (const [status, code] of contract) {
    next = {
      status,
      body: { error: { code, message: `SENTINEL odoo text for ${TOKEN}` } },
    };
    await rejectsWith(
      okfToolPack.tools.odoo_search.handler(ARGS.odoo_search, context(server.url)),
      code,
    );
  }
  const other = [
    [
      { status: 500, body: { error: { code: "not_in_contract", message: "SENTINEL" } } },
      "server_error",
    ],
    [{ status: 502, body: "<html>SENTINEL</html>", contentType: "text/html" }, "invalid_response"],
    [
      { status: 404, body: "<html>no route</html>", contentType: "text/html" },
      "data_api_unavailable",
    ],
    [
      { status: 303, body: "", contentType: "text/html", headers: { Location: "/web/login" } },
      "data_api_unavailable",
    ],
    [{ status: 200, body: { unexpected: true } }, "invalid_response"],
    [{ status: 200, body: { result: [1, 2] } }, "invalid_response"],
    [{ status: 200, body: "not json", contentType: "application/json" }, "invalid_response"],
  ];
  for (const [reply, code] of other) {
    next = reply;
    await rejectsWith(
      okfToolPack.tools.odoo_search.handler(ARGS.odoo_search, context(server.url)),
      code,
    );
  }
});

test("a response is cut at the size cap while it streams", async (t) => {
  let closed = false;
  const server = await fakeDataApi(t, () => (response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write('{"result":{"records":[');
    const timer = setInterval(() => response.write(`{"name":"${"x".repeat(1024)}"},`), 5);
    response.on("close", () => {
      closed = true;
      clearInterval(timer);
    });
  });
  const pack = createOdooToolPack({ maxResponseBytes: 16 * 1024 });
  const started = Date.now();
  await rejectsWith(
    pack.tools.odoo_search.handler(ARGS.odoo_search, context(server.url)),
    "result_too_large",
  );
  assert.ok(Date.now() - started < 2000);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(closed, true);
});

test("the host's abort signal and the configured timeout stop a call", async (t) => {
  const server = await fakeDataApi(t, () => undefined);
  const controller = new AbortController();
  const pending = okfToolPack.tools.odoo_read.handler(
    ARGS.odoo_read,
    context(server.url, { signal: controller.signal }),
  );
  setTimeout(() => controller.abort(), 20);
  await rejectsWith(pending, "aborted");
  const slow = context(server.url);
  slow.config = { ...slow.config, timeoutMs: 1000 };
  const started = Date.now();
  await rejectsWith(okfToolPack.tools.odoo_read.handler(ARGS.odoo_read, slow), "timeout");
  assert.ok(Date.now() - started < 3000);
});

test("without a subject token, valid arguments, config or credentials nothing is sent", async (t) => {
  const server = await fakeDataApi(t, () => ({ body: { result: {} } }));
  const tools = okfToolPack.tools;
  for (const subjectToken of [undefined, null, ""]) {
    await rejectsWith(
      tools.odoo_search.handler(ARGS.odoo_search, context(server.url, { subjectToken })),
      "subject_token_required",
    );
  }
  const invalid = [
    ["odoo_find_models", { query: "x", extra: TOKEN }],
    ["odoo_find_models", { limit: 51 }],
    ["odoo_describe_model", {}],
    ["odoo_describe_model", { model: "Res Partner" }],
    ["odoo_search", { ...ARGS.odoo_search, limit: 201 }],
    ["odoo_search", { ...ARGS.odoo_search, fields: [] }],
    ["odoo_search", { ...ARGS.odoo_search, domain: [["state", "drop table", 1]] }],
    ["odoo_search", { ...ARGS.odoo_search, domain: [["state", "="]] }],
    ["odoo_search", { ...ARGS.odoo_search, domain: ["&&"] }],
    ["odoo_search", { ...ARGS.odoo_search, order: "name; delete" }],
    ["odoo_read", { ...ARGS.odoo_read, ids: Array.from({ length: 101 }, (_, i) => i + 1) }],
    ["odoo_read", { ...ARGS.odoo_read, ids: [0] }],
    ["odoo_group", { ...ARGS.odoo_group, aggregates: ["amount_total:median"] }],
    ["odoo_group", { ...ARGS.odoo_group, aggregates: ["is_company:bool_and"] }],
    ["odoo_group", { ...ARGS.odoo_group, aggregates: ["is_company:bool_or"] }],
    ["odoo_group", { ...ARGS.odoo_group, aggregates: ["name:array_agg"] }],
    ["odoo_group", { ...ARGS.odoo_group, order: "amount_total:sum desc; drop" }],
    ["odoo_search", { ...ARGS.odoo_search, domain: [["a.b.c.d.e", "=", 1]] }],
    ["odoo_search", { ...ARGS.odoo_search, domain: [["parent_id", "child_of", 1]] }],
    ["odoo_group", { ...ARGS.odoo_group, domain: [["parent_id", "parent_of", 1]] }],
    ["odoo_search", { ...ARGS.odoo_search, order: "partner_id.name desc" }],
    ["odoo_search", { ...ARGS.odoo_search, order: "amount_total:sum" }],
    ["odoo_group", { ...ARGS.odoo_group, limit: 501 }],
    ["odoo_group", { ...ARGS.odoo_group, groupby: ["date_order:decade"] }],
  ];
  for (const [name, args] of invalid) {
    await assert.rejects(tools[name].handler(args, context(server.url)), (error) => {
      assert.equal(error.code, "invalid_arguments", `${name} ${JSON.stringify(args).slice(0, 80)}`);
      // Only the parameter name and its position reach the host, as details.
      assert.deepEqual(Object.keys(error.details), ["field", "path"]);
      assert.ok(Object.values(error.details).every((value) => typeof value === "string"));
      assert.equal(error.field, undefined);
      assert.doesNotMatch(JSON.stringify({ ...error, message: error.message }), /SENTINEL/);
      return true;
    });
  }
  await rejectsWith(
    tools.odoo_read.handler(ARGS.odoo_read, context(server.url, { getSecret: () => "" })),
    "client_credentials_unavailable",
  );
  await rejectsWith(
    tools.odoo_read.handler(ARGS.odoo_read, context(server.url, { getSecret: undefined })),
    "client_credentials_unavailable",
  );
  await rejectsWith(
    tools.odoo_read.handler(
      ARGS.odoo_read,
      context(server.url, { config: { url: "http://odoo.example.com" } }),
    ),
    "invalid_config",
  );
  assert.equal(server.requests.length, 0);
});

test("validateConfig reports one diagnostic per invalid key without echoing it", () => {
  const base = {
    url: "https://odoo.example.com/",
    clientIdEnv: "O3P_CLIENT_ID",
    clientSecretEnv: "O3P_CLIENT_SECRET",
  };
  const valid = okfToolPack.validateConfig(base);
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.config, { ...base, url: "https://odoo.example.com", timeoutMs: 25000 });
  assert.equal(okfToolPack.validateConfig(valid.config).valid, true, "normalised config is valid");
  const cases = [
    [{ ...base, url: undefined }, "missing_url", "url"],
    [{ ...base, url: "http://odoo.example.com" }, "invalid_url", "url"],
    [{ ...base, url: "https://SENTINEL:pw@odoo.example.com" }, "invalid_url", "url"],
    [{ ...base, clientIdEnv: undefined }, "missing_client_id_env", "clientIdEnv"],
    [
      { ...base, clientSecretEnv: "SENTINEL secret" },
      "invalid_client_secret_env",
      "clientSecretEnv",
    ],
    [{ ...base, clientSecretEnv: "O3P_CLIENT_ID" }, "same_credential_env", "clientSecretEnv"],
    [{ ...base, timeoutMs: 10 }, "invalid_timeout_ms", "timeoutMs"],
    [{ ...base, clientSecret: "SENTINEL" }, "unknown_config_key", "clientSecret"],
  ];
  for (const [config, code, field] of cases) {
    const result = okfToolPack.validateConfig(config);
    assert.equal(result.valid, false, code);
    assert.deepEqual(
      result.diagnostics.map((entry) => [entry.code, entry.field]),
      [[code, field]],
    );
    assert.doesNotMatch(JSON.stringify(result.diagnostics), /SENTINEL/);
  }
  assert.equal(okfToolPack.validateConfig(null).diagnostics[0].code, "invalid_config");
});

test("no sentinel reaches the console on any path", async (t) => {
  const server = await fakeDataApi(t, ({ url }) =>
    url.endsWith("/read")
      ? { status: 403, body: { error: { code: "access_denied", message: TOKEN } } }
      : { body: { result: RESULTS[url.split("/").pop()] } },
  );
  const written = [];
  const original = {};
  for (const stream of ["log", "info", "warn", "error", "debug"]) {
    original[stream] = console[stream];
    console[stream] = (...parts) => written.push(parts.join(" "));
  }
  const writes = [process.stdout.write, process.stderr.write];
  const capture =
    (stream, write) =>
    (chunk, ...rest) => {
      written.push(String(chunk));
      return write.call(stream, chunk, ...rest);
    };
  process.stdout.write = capture(process.stdout, writes[0]);
  process.stderr.write = capture(process.stderr, writes[1]);
  const outcomes = [];
  try {
    for (const name of NAMES) {
      try {
        outcomes.push(await okfToolPack.tools[name].handler(ARGS[name], context(server.url)));
      } catch (error) {
        outcomes.push({ code: error.code, message: error.message, stack: error.stack });
      }
    }
  } finally {
    Object.assign(console, original);
    [process.stdout.write, process.stderr.write] = writes;
  }
  assert.equal(outcomes.filter((outcome) => outcome.code).length, 1);
  assert.doesNotMatch(JSON.stringify(outcomes), /SENTINEL|secret\/\+/);
  assert.doesNotMatch(written.join("\n"), /SENTINEL|secret\/\+/);
});

test("a four-field path and every allowed aggregate pass the schema", async (t) => {
  const server = await fakeDataApi(t, ({ url }) => ({
    body: { result: RESULTS[url.split("/").pop()] },
  }));
  await okfToolPack.tools.odoo_search.handler(
    { ...ARGS.odoo_search, domain: [["partner_id.country_id.currency_id.name", "=", "EUR"]] },
    context(server.url),
  );
  await okfToolPack.tools.odoo_group.handler(
    {
      ...ARGS.odoo_group,
      aggregates: [
        "amount_total:sum",
        "amount_total:avg",
        "amount_total:min",
        "amount_total:max",
        "partner_id:count",
        "partner_id:count_distinct",
        "__count",
      ],
      order: "__count desc, partner_id",
    },
    context(server.url),
  );
  assert.equal(server.requests.length, 2);
});

test("an argument error names the offending parameter in details, never a status", async (t) => {
  const server = await fakeDataApi(t, () => ({
    status: 400,
    body: { error: { code: "invalid_params", message: "SENTINEL" } },
  }));
  await assert.rejects(
    okfToolPack.tools.odoo_search.handler(
      { ...ARGS.odoo_search, domain: [["state", "drop", 1]] },
      context(server.url),
    ),
    (error) => {
      assert.deepEqual(error.details, { field: "domain", path: "/domain/0" });
      return true;
    },
  );
  await assert.rejects(
    okfToolPack.tools.odoo_search.handler({ ...ARGS.odoo_search, extra: 1 }, context(server.url)),
    (error) => {
      assert.deepEqual(error.details, {
        field: "(unexpected property)",
        path: "/(unexpected property)",
      });
      return true;
    },
  );
  await assert.rejects(
    okfToolPack.tools.odoo_search.handler(ARGS.odoo_search, context(server.url)),
    (error) => {
      assert.equal(error.code, "invalid_params");
      assert.equal(error.details, undefined);
      assert.equal(error.status, 400);
      return true;
    },
  );
});

test("odoo_sql teaches its rules and defaults to 100 rows", async (t) => {
  const sql = okfToolPack.tools.odoo_sql;
  for (const pattern of [
    /single SELECT, VALUES or TABLE statement/,
    /exactly the rows and fields the signed-in user may read/,
    /all of the user's companies/,
    /`odoo` knowledge bundle or with odoo_describe_model/,
    /not always the model name with dots replaced/,
    /instead of SELECT \*/,
    /\\x… hexadecimal for bytea/,
    /0A000.*42601.*42P01/,
    /at most two queries at once/,
  ]) {
    assert.match(sql.description, pattern);
  }
  assert.match(okfToolPack.tools.odoo_describe_model.description, /table/);
  assert.deepEqual(sql.outputSchema.required, ["columns", "rows", "truncated", "tables"]);
  const server = await fakeDataApi(t, () => ({ body: { result: RESULTS.sql } }));
  await sql.handler({ query: "SELECT 1" }, context(server.url));
  assert.deepEqual(server.requests[0].body.params, { limit: 100, query: "SELECT 1" });
  for (const args of [
    {},
    { query: "" },
    { query: "SELECT 1", limit: 0 },
    { query: "SELECT 1", limit: 1001 },
    { query: "x".repeat(20001) },
    { query: "SELECT 1", model: "res.partner" },
  ]) {
    await assert.rejects(sql.handler(args, context(server.url)), (error) => {
      assert.equal(error.code, "invalid_arguments");
      return true;
    });
  }
  assert.equal(server.requests.length, 1);
});

test("odoo_sql passes on PostgreSQL's answer, bounded, and the SQL-only codes", async (t) => {
  let next = null;
  const server = await fakeDataApi(t, () => next);
  const sql = okfToolPack.tools.odoo_sql;
  const queryError = (details) => ({
    status: 422,
    body: { error: { code: "query_error", message: "The query could not be run.", details } },
  });
  const cases = [
    [
      { sqlstate: "42703", position: 8, message: 'column "nope" does not exist' },
      { sqlstate: "42703", position: 8, message: 'column "nope" does not exist' },
    ],
    [
      { sqlstate: "42P01", position: null, message: `relation "x" does not exist\nLINE 1:\u0085` },
      { sqlstate: "42P01", position: null, message: 'relation "x" does not exist LINE 1:' },
    ],
    [
      { sqlstate: "0A000", position: 1, message: "y".repeat(800) },
      { sqlstate: "0A000", position: 1, message: "y".repeat(500) },
    ],
    [
      { sqlstate: "4270", position: "8", message: `echo ${TOKEN}` },
      { sqlstate: null, position: null, message: null },
    ],
    [
      { sqlstate: "42601", position: -3, message: `near ${CLIENT_SECRET}` },
      { sqlstate: "42601", position: null, message: null },
    ],
  ];
  for (const [sent, expected] of cases) {
    next = queryError(sent);
    await assert.rejects(sql.handler(ARGS.odoo_sql, context(server.url)), (error) => {
      assert.equal(error.code, "query_error");
      assert.deepEqual(error.details, expected);
      assert.doesNotMatch(JSON.stringify(error.details), /SENTINEL/);
      return true;
    });
  }
  next = queryError(undefined);
  await assert.rejects(sql.handler(ARGS.odoo_sql, context(server.url)), (error) => {
    assert.equal(error.code, "query_error");
    assert.equal(error.details, undefined);
    return true;
  });
  // Only sql carries PostgreSQL's answer; another operation's details are dropped.
  next = queryError({ sqlstate: "42703", position: 1, message: "m" });
  await assert.rejects(
    okfToolPack.tools.odoo_search.handler(ARGS.odoo_search, context(server.url)),
    (error) => error.code === "query_error" && error.details === undefined,
  );
  for (const [status, code] of [
    [429, "too_many_requests"],
    [503, "unavailable"],
    [413, "result_too_large"],
    [504, "timeout"],
    [403, "insufficient_scope"],
  ]) {
    next = { status, body: { error: { code, message: `SENTINEL ${TOKEN}` } } };
    await rejectsWith(sql.handler(ARGS.odoo_sql, context(server.url)), code);
  }
});

test("odoo_sql stops on abort and on its timeout", async (t) => {
  const server = await fakeDataApi(t, () => undefined);
  const controller = new AbortController();
  const pending = okfToolPack.tools.odoo_sql.handler(
    ARGS.odoo_sql,
    context(server.url, { signal: controller.signal }),
  );
  setTimeout(() => controller.abort(), 20);
  await rejectsWith(pending, "aborted");
  const slow = context(server.url);
  slow.config = { ...slow.config, timeoutMs: 1000 };
  await rejectsWith(okfToolPack.tools.odoo_sql.handler(ARGS.odoo_sql, slow), "timeout");
});

test("an error's field, reason and hint reach the host as bounded details", async (t) => {
  let next = null;
  const server = await fakeDataApi(t, () => next);
  const tools = okfToolPack.tools;
  const refuse = (status, code, details) => ({
    status,
    body: { error: { code, message: "fixed text", details } },
  });
  next = refuse(400, "invalid_params", {
    field: "domain",
    reason: "unknown_field",
    hint: "Use odoo_describe_model to list the searchable fields.",
    extra: "ignored",
  });
  await assert.rejects(
    tools.odoo_search.handler(ARGS.odoo_search, context(server.url)),
    (error) => {
      assert.equal(error.code, "invalid_params");
      assert.deepEqual(error.details, {
        field: "domain",
        reason: "unknown_field",
        hint: "Use odoo_describe_model to list the searchable fields.",
      });
      return true;
    },
  );
  next = refuse(400, "invalid_params", {
    field: 42,
    reason: `holds ${TOKEN}`,
    hint: `${"h".repeat(300)}\nsecond line`,
  });
  await assert.rejects(tools.odoo_group.handler(ARGS.odoo_group, context(server.url)), (error) => {
    assert.deepEqual(error.details, { hint: "h".repeat(200) });
    return true;
  });
  for (const [status, code, tool] of [
    [404, "unknown_model", "odoo_describe_model"],
    [403, "access_denied", "odoo_read"],
  ]) {
    next = refuse(status, code, { field: "model", reason: code, hint: "Try odoo_find_models." });
    await assert.rejects(tools[tool].handler(ARGS[tool], context(server.url)), (error) => {
      assert.equal(error.code, code);
      assert.deepEqual(error.details, {
        field: "model",
        reason: code,
        hint: "Try odoo_find_models.",
      });
      return true;
    });
  }
  next = refuse(400, "invalid_params", null);
  await assert.rejects(tools.odoo_read.handler(ARGS.odoo_read, context(server.url)), (error) => {
    assert.equal(error.details, undefined);
    return true;
  });
  next = refuse(422, "query_error", {
    sqlstate: "42703",
    position: 8,
    message: 'column "x" does not exist',
    hint: "Name columns from odoo_describe_model.",
  });
  await assert.rejects(tools.odoo_sql.handler(ARGS.odoo_sql, context(server.url)), (error) => {
    assert.deepEqual(error.details, {
      hint: "Name columns from odoo_describe_model.",
      sqlstate: "42703",
      position: 8,
      message: 'column "x" does not exist',
    });
    return true;
  });
});

test("models pages with offset and describe reports how fields may be used", async (t) => {
  let next = null;
  const server = await fakeDataApi(t, () => next);
  const { odoo_find_models: find, odoo_describe_model: describe } = okfToolPack.tools;
  next = {
    body: { result: { models: RESULTS.models, total: 120, truncated: true } },
  };
  assert.deepEqual(await find.handler({ query: "sale", offset: 50 }, context(server.url)), {
    models: RESULTS.models,
    total: 120,
    truncated: true,
  });
  assert.deepEqual(server.requests[0].body.params, { query: "sale", offset: 50 });
  next = { body: { result: RESULTS.models } };
  assert.deepEqual(await find.handler({}, context(server.url)), { models: RESULTS.models });
  await assert.rejects(find.handler({ offset: -1 }, context(server.url)), {
    code: "invalid_arguments",
  });
  assert.deepEqual(Object.keys(find.outputSchema.properties), ["models", "total", "truncated"]);
  assert.match(find.description, /page with offset/);
  assert.match(find.description, /hr\.employee\.public next to hr\.employee/);
  const flags = describe.outputSchema.properties.fields.items.properties;
  for (const flag of ["stored", "searchable", "sortable", "groupable"]) {
    assert.deepEqual(flags[flag], { type: "boolean" });
  }
  assert.match(describe.description, /searchable \(usable in a domain\)/);
  for (const name of ["odoo_search", "odoo_group"]) {
    assert.match(
      okfToolPack.tools[name].description,
      /Filter only on fields odoo_describe_model marks searchable/,
    );
  }
  for (const name of ["odoo_describe_model", "odoo_search", "odoo_read", "odoo_group"]) {
    assert.match(
      okfToolPack.tools[name].description,
      /details name the parameter \(field\), the reason and a hint/,
    );
  }
});
