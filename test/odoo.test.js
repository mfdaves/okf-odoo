"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { OdooError, callOdoo, createOdooClient, normalizeBaseUrl } = require("../src/odoo");
const { odooError, startFakeOdoo } = require("./support/fake-odoo");

const FIELDS = { fields: ["name"] };

async function withServer(t, handle) {
  const server = await startFakeOdoo(handle);
  t.after(() => server.close());
  return server;
}

function rejectsWith(promise, code) {
  return assert.rejects(promise, (error) => {
    assert.ok(error instanceof OdooError, `expected OdooError, got ${error}`);
    assert.equal(error.code, code);
    return true;
  });
}

test("a call posts JSON to /json/2/<model>/<method> with the bearer key and database", async (t) => {
  const server = await withServer(t, () => [{ id: 1, name: "Base" }]);
  const result = await callOdoo({
    url: `${server.url}/`,
    database: "erp",
    apiKey: "k3y",
    model: "ir.module.module",
    method: "search_read",
    params: { domain: [["state", "=", "installed"]], fields: ["name"] },
  });
  assert.deepEqual(result, [{ id: 1, name: "Base" }]);
  const [request] = server.requests;
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/json/2/ir.module.module/search_read");
  assert.equal(request.headers.authorization, "bearer k3y");
  assert.match(request.headers["content-type"], /^application\/json/);
  assert.equal(request.headers["x-odoo-database"], "erp");
  assert.deepEqual(request.params, { domain: [["state", "=", "installed"]], fields: ["name"] });
});

test("the database header is omitted when no database is configured", async (t) => {
  const server = await withServer(t, () => ({}));
  await callOdoo({ url: server.url, apiKey: "k", model: "res.groups", method: "fields_get" });
  assert.equal(server.requests[0].headers["x-odoo-database"], undefined);
  assert.equal(server.requests[0].raw, "{}");
});

test("a write or private method is refused before any request is sent", async (t) => {
  const server = await withServer(t, () => true);
  for (const method of ["write", "create", "unlink", "action_install", "_read", "call_kw"]) {
    await rejectsWith(
      callOdoo({ url: server.url, apiKey: "k", model: "res.users", method }),
      "method_not_allowed",
    );
  }
  assert.equal(server.requests.length, 0);
});

test("reads must name their fields and system parameters are never requested", async (t) => {
  const server = await withServer(t, () => []);
  const base = { url: server.url, apiKey: "k" };
  for (const params of [{}, { fields: [] }, { fields: ["name", "x; drop"] }]) {
    await rejectsWith(
      callOdoo({ ...base, model: "ir.cron", method: "search_read", params }),
      "fields_required",
    );
  }
  await rejectsWith(callOdoo({ ...base, model: "ir.model", method: "read" }), "fields_required");
  await rejectsWith(
    callOdoo({
      ...base,
      model: "ir.config_parameter",
      method: "search_read",
      params: { fields: ["key"] },
    }),
    "model_not_allowed",
  );
  assert.equal(server.requests.length, 0);
});

test("HTTP failures map to fixed codes without echoing server text", async (t) => {
  const secret = "Traceback: password=hunter2";
  const replies = {
    "res.users": odooError(401, "werkzeug.exceptions.Unauthorized", secret),
    "ir.cron": odooError(403, "odoo.exceptions.AccessError", secret),
    "no.such": odooError(404, "werkzeug.exceptions.NotFound", secret),
    "ir.model": odooError(422, "werkzeug.exceptions.UnprocessableEntity", secret),
    "ir.rule": odooError(500, "builtins.Exception", secret),
    "ir.ui.menu": { status: 404, contentType: "text/html", body: `<html>${secret}</html>` },
    "res.groups": { status: 200, contentType: "text/html", body: "<html></html>" },
  };
  const server = await withServer(t, ({ model }) => replies[model]);
  const expected = {
    "res.users": "invalid_api_key",
    "ir.cron": "access_denied",
    "no.such": "model_not_found",
    "ir.model": "invalid_request",
    "ir.rule": "server_error",
    "ir.ui.menu": "json2_unavailable",
    "res.groups": "invalid_response",
  };
  for (const [model, code] of Object.entries(expected)) {
    await assert.rejects(
      callOdoo({ url: server.url, apiKey: "k", model, method: "search_read", params: FIELDS }),
      (error) => {
        assert.equal(error.code, code, model);
        assert.equal(error.model, model);
        assert.doesNotMatch(error.message, /hunter2|Traceback/);
        assert.doesNotMatch(JSON.stringify(error), /hunter2|Traceback/);
        return true;
      },
    );
  }
});

test("a slow server times out and an aborted signal stops the call", async (t) => {
  const server = await withServer(t, () => undefined);
  await rejectsWith(
    callOdoo({
      url: server.url,
      apiKey: "k",
      model: "ir.model",
      method: "read",
      params: FIELDS,
      timeoutMs: 50,
    }),
    "timeout",
  );
  const controller = new AbortController();
  const pending = callOdoo({
    url: server.url,
    apiKey: "k",
    model: "ir.model",
    method: "read",
    params: FIELDS,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 20);
  await rejectsWith(pending, "aborted");
  await rejectsWith(
    callOdoo({
      url: server.url,
      apiKey: "k",
      model: "ir.model",
      method: "read",
      params: FIELDS,
      signal: controller.signal,
    }),
    "aborted",
  );
});

test("an unreachable server is reported as a connection failure", async () => {
  await rejectsWith(
    callOdoo({
      url: "http://127.0.0.1:9",
      apiKey: "k",
      model: "ir.model",
      method: "read",
      params: FIELDS,
    }),
    "connection_failed",
  );
});

test("search_read pages by id until a short page arrives", async (t) => {
  const rows = [1, 2, 3, 4, 5].map((id) => ({ id }));
  const server = await withServer(t, ({ params }) =>
    rows.slice(params.offset, params.offset + params.limit),
  );
  const client = createOdooClient({ url: server.url, apiKey: "k", pageSize: 2 });
  const result = await client.searchRead("ir.model", { domain: [], fields: ["model"] });
  assert.deepEqual(result, rows);
  assert.deepEqual(
    server.requests.map((request) => [
      request.params.offset,
      request.params.limit,
      request.params.order,
    ]),
    [
      [0, 2, "id"],
      [2, 2, "id"],
      [4, 2, "id"],
    ],
  );
  assert.deepEqual(server.requests[0].params.fields, ["model"]);
});

test("the base URL must be https, or http on loopback, without credentials, query, or fragment", () => {
  assert.equal(normalizeBaseUrl("https://erp.example.com/odoo/"), "https://erp.example.com/odoo");
  assert.equal(normalizeBaseUrl("http://127.0.0.1:18069/"), "http://127.0.0.1:18069");
  assert.equal(normalizeBaseUrl("http://localhost:8069"), "http://localhost:8069");
  assert.equal(normalizeBaseUrl("http://[::1]:8069"), "http://[::1]:8069");
  for (const value of [
    "http://erp.example.com",
    "http://10.0.0.5:8069",
    "http://127.0.0.1.example.com",
    "ftp://erp.example.com",
    "https://admin:secret@erp.example.com",
    "https://erp.example.com/?db=x",
    "not a url",
  ]) {
    assert.throws(() => normalizeBaseUrl(value), TypeError, value);
  }
  assert.throws(() => createOdooClient({ url: "https://u:p@erp.example.com", apiKey: "k" }));
});

test("the response size limit applies while the body streams", async (t) => {
  let closed = false;
  const server = http.createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write("[");
    // Never ends: a client that buffers before checking would wait for the timeout.
    const timer = setInterval(() => response.write(`${JSON.stringify("x".repeat(1024))},`), 5);
    response.on("close", () => {
      closed = true;
      clearInterval(timer);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const started = Date.now();
  await rejectsWith(
    callOdoo({
      url,
      apiKey: "k",
      model: "ir.model",
      method: "search_read",
      params: FIELDS,
      timeoutMs: 10000,
      maxResponseBytes: 16 * 1024,
    }),
    "response_too_large",
  );
  assert.ok(Date.now() - started < 2000, "stopped reading at the limit");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(closed, true, "the connection was released");
});

test("a declared Content-Length above the limit is refused before reading", async (t) => {
  const server = http.createServer((request, response) => {
    request.resume();
    // Announces a large body and sends none: only the header can end the call.
    response.writeHead(200, { "Content-Type": "application/json", "Content-Length": "1000000" });
    response.flushHeaders();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const started = Date.now();
  await rejectsWith(
    callOdoo({
      url: `http://127.0.0.1:${server.address().port}`,
      apiKey: "k",
      model: "ir.model",
      method: "search_read",
      params: FIELDS,
      timeoutMs: 10000,
      maxResponseBytes: 1024,
    }),
    "response_too_large",
  );
  assert.ok(Date.now() - started < 2000);
});
