"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { OdooError, authenticateJsonRpc, callJsonRpc, createOdooClient } = require("../src/odoo");
const { odooError, startFakeOdoo } = require("./support/fake-odoo");

const RPC = { database: "erp", login: "okf-reader", apiKey: "k3y", uid: 7 };
const FIELDS = { fields: ["name"] };

async function withServer(t, handle, jsonrpc = RPC) {
  const server = await startFakeOdoo(handle, { jsonrpc });
  t.after(() => server.close());
  return server;
}

function client(server, extra = {}) {
  return createOdooClient({
    api: "jsonrpc",
    url: server.url,
    database: RPC.database,
    login: RPC.login,
    apiKey: RPC.apiKey,
    ...extra,
  });
}

function rejectsWith(promise, code) {
  return assert.rejects(promise, (error) => {
    assert.ok(error instanceof OdooError, `expected OdooError, got ${error}`);
    assert.equal(error.code, code);
    return true;
  });
}

test("the user id is resolved once and every read is execute_kw on /jsonrpc", async (t) => {
  const server = await withServer(t, ({ model }) => [{ id: 1, name: model }]);
  const odoo = client(server);
  assert.deepEqual(await odoo.call("ir.model", "search_read", FIELDS), [
    { id: 1, name: "ir.model" },
  ]);
  await odoo.fieldsGet("res.groups", ["type"]);
  const [auth, first, second] = server.requests;
  assert.equal(server.requests.length, 3);
  assert.equal(auth.url, "/jsonrpc");
  assert.equal(auth.service, "common");
  assert.equal(auth.rpc, "authenticate");
  assert.deepEqual(auth.args, ["erp", "okf-reader", "k3y", {}]);
  assert.equal(first.service, "object");
  assert.deepEqual(first.args, ["erp", 7, "k3y", "ir.model", "search_read", [], FIELDS]);
  assert.deepEqual(second.args.slice(3), [
    "res.groups",
    "fields_get",
    [],
    { attributes: ["type"] },
  ]);
  assert.equal(first.headers.authorization, undefined);
  assert.match(first.headers["content-type"], /^application\/json/);
});

test("search_read pages through execute_kw keyword arguments", async (t) => {
  const rows = [1, 2, 3, 4, 5].map((id) => ({ id }));
  const server = await withServer(t, ({ params }) =>
    rows.slice(params.offset, params.offset + params.limit),
  );
  const result = await client(server, { pageSize: 2 }).searchRead("ir.model", {
    domain: [["transient", "=", false]],
    fields: ["model"],
    context: { lang: "en_US" },
  });
  assert.deepEqual(result, rows);
  const reads = server.requests.filter((request) => request.service === "object");
  assert.deepEqual(
    reads.map((request) => [request.params.offset, request.params.limit, request.params.order]),
    [
      [0, 2, "id"],
      [2, 2, "id"],
      [4, 2, "id"],
    ],
  );
  assert.deepEqual(reads[0].params.context, { lang: "en_US" });
  assert.deepEqual(reads[0].params.domain, [["transient", "=", false]]);
});

test("a write method or an unlisted read is refused before authenticating", async (t) => {
  const server = await withServer(t, () => true);
  const odoo = client(server);
  for (const method of ["write", "create", "unlink", "_read", "authenticate"]) {
    await rejectsWith(odoo.call("res.users", method, FIELDS), "method_not_allowed");
  }
  await rejectsWith(odoo.call("ir.model", "search_read", {}), "fields_required");
  await rejectsWith(
    odoo.call("ir.config_parameter", "search_read", { fields: ["key"] }),
    "model_not_allowed",
  );
  assert.equal(server.requests.length, 0);
});

test("JSON-RPC needs a database and a login", () => {
  const base = { api: "jsonrpc", url: "http://127.0.0.1:8069", apiKey: "k" };
  assert.throws(() => createOdooClient({ ...base, login: "u" }), /database/);
  assert.throws(() => createOdooClient({ ...base, database: "erp" }), /login/);
  assert.throws(() => createOdooClient({ ...base, database: "erp", login: "a\nb" }), /login/);
  assert.throws(() => createOdooClient({ ...base, api: "xmlrpc" }), /json2 or jsonrpc/);
  assert.throws(
    () => createOdooClient({ ...base, url: "http://erp.example.com", database: "e", login: "u" }),
    /https/,
  );
});

test("a wrong login or key is invalid_api_key and stops the client", async (t) => {
  const server = await withServer(t, () => []);
  const odoo = client(server, { apiKey: "wrong" });
  await rejectsWith(odoo.call("ir.model", "search_read", FIELDS), "invalid_api_key");
  await rejectsWith(odoo.call("ir.model", "search_read", FIELDS), "invalid_api_key");
  assert.equal(server.requests.length, 1, "authentication is not retried");
  await rejectsWith(
    callJsonRpc({
      url: server.url,
      database: "erp",
      login: "okf-reader",
      apiKey: "k3y",
      uid: 99,
      model: "ir.model",
      method: "search_read",
      params: FIELDS,
    }),
    "invalid_api_key",
  );
});

test("JSON-RPC errors map to fixed codes by exception name, never by server text", async (t) => {
  const replies = {
    "ir.cron": odooError(403, "x", "secret detail"),
    "no.such": odooError(404, "x", "secret detail"),
    "ir.rule": odooError(500, "x", "secret detail"),
  };
  const server = await withServer(t, ({ model }) => replies[model] || []);
  const odoo = client(server);
  const expected = {
    "ir.cron": "access_denied",
    "no.such": "invalid_request",
    "ir.rule": "server_error",
  };
  for (const [model, code] of Object.entries(expected)) {
    await assert.rejects(odoo.call(model, "search_read", FIELDS), (error) => {
      assert.equal(error.code, code, model);
      assert.equal(error.model, model);
      assert.doesNotMatch(
        JSON.stringify({ ...error, message: error.message }),
        /server text|secret/,
      );
      return true;
    });
  }
});

test("a server without /jsonrpc, a wrong database, a timeout and an abort", async (t) => {
  const plain = await withServer(t, () => [], null);
  await rejectsWith(client(plain).call("ir.model", "search_read", FIELDS), "jsonrpc_unavailable");

  const server = await withServer(t, () => undefined);
  await rejectsWith(
    authenticateJsonRpc({ url: server.url, database: "other", login: "okf-reader", apiKey: "k3y" }),
    "server_error",
  );
  await rejectsWith(
    client(server, { timeoutMs: 50 }).call("ir.model", "search_read", FIELDS),
    "timeout",
  );
  const controller = new AbortController();
  const pending = client(server, { signal: controller.signal }).call(
    "ir.model",
    "search_read",
    FIELDS,
  );
  setTimeout(() => controller.abort(), 20);
  await rejectsWith(pending, "aborted");
});
