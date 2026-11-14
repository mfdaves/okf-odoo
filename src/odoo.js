"use strict";

// Minimal read-only Odoo client over one of two protocols, chosen by the
// caller: JSON-2 (Odoo 19 and later), one POST per call to
// /json/2/<model>/<method> with a bearer API key, or JSON-RPC (Odoo 18 and
// later), `execute_kw` on /jsonrpc with the user id and the API key as
// password. Either way only read methods can be called, reads must name the
// fields they want, and errors carry a fixed code and message, never server
// text.

const READ_METHODS = new Set(["fields_get", "read", "search_read"]);
// Holds system parameters, which may carry credentials; never metadata.
const FORBIDDEN_MODELS = new Set(["ir.config_parameter"]);
const FIELD_NAME = /^[a-z_][a-z0-9_]*$/;
const APIS = new Set(["json2", "jsonrpc"]);
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_PAGE_SIZE = 500;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MODEL_NAME = /^[a-z_][a-z0-9_]*(\.[a-z0-9_]+)*$/;

const MESSAGES = {
  aborted: "The Odoo request was aborted.",
  access_denied: "The Odoo API key's user may not read this metadata.",
  connection_failed: "The Odoo server could not be reached.",
  invalid_api_key: "Odoo rejected the login or API key.",
  invalid_request: "Odoo rejected the request parameters.",
  invalid_response: "Odoo returned a response that is not JSON.",
  json2_unavailable: "The Odoo server offers no JSON-2 API for this database.",
  jsonrpc_unavailable: "The Odoo server offers no JSON-RPC endpoint.",
  fields_required: "A read must name the fields it wants.",
  method_not_allowed: "Only read methods may be called.",
  model_not_allowed: "This Odoo model is never read.",
  model_not_found: "The Odoo model or method does not exist on this database.",
  response_too_large: "The Odoo response exceeds the size limit.",
  server_error: "The Odoo server failed to answer the request.",
  timeout: "The Odoo request timed out.",
};

class OdooError extends Error {
  constructor(code, details = {}) {
    const subject = details.model
      ? ` (${details.model}${details.method ? `.${details.method}` : ""})`
      : "";
    super(`${MESSAGES[code] || "The Odoo request failed."}${subject}`);
    this.name = "OdooError";
    this.code = code;
    Object.assign(this, details);
  }
}

function normalizeBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new TypeError("The Odoo url must be an absolute http or https URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TypeError("The Odoo url must be an http or https URL without credentials.");
  }
  if (parsed.search || parsed.hash) {
    throw new TypeError("The Odoo url must not carry a query or fragment.");
  }
  // The API key travels as a bearer token, so plain http is only for a server
  // on this machine.
  if (parsed.protocol === "http:" && !isLoopback(parsed.hostname)) {
    throw new TypeError("The Odoo url must use https unless the host is a loopback address.");
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "[::1]" || /^127(\.\d{1,3}){3}$/.test(hostname);
}

// The JSON-2 dispatcher answers an unknown model or method with 404 and a JSON
// error body. A server without the route answers 404 with an HTML page (no rpc
// module) or redirects to its login page (Odoo 18 and older).
function errorForStatus(response, isJson, details) {
  const status = response.status;
  if (status >= 300 && status < 400)
    return new OdooError("json2_unavailable", { ...details, status });
  if (status === 401) return new OdooError("invalid_api_key", { ...details, status });
  if (status === 403) return new OdooError("access_denied", { ...details, status });
  if (status === 404) {
    return new OdooError(isJson ? "model_not_found" : "json2_unavailable", { ...details, status });
  }
  if (status === 400 || status === 415 || status === 422) {
    return new OdooError("invalid_request", { ...details, status });
  }
  return new OdooError("server_error", { ...details, status });
}

// Reads the body chunk by chunk and stops as soon as it passes the limit, so
// an oversized or endless response is never buffered whole.
async function readBody(response, details, limit) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) {
    await response.body?.cancel().catch(() => {});
    throw new OdooError("response_too_large", details);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new OdooError("response_too_large", details);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Checks done before any request: a read method, a well-formed model that is
// not refused, an explicit list of field names, a printable key.
function checkRead({ model, method, params, apiKey }) {
  if (!READ_METHODS.has(method)) throw new OdooError("method_not_allowed", { model, method });
  if (typeof model !== "string" || !MODEL_NAME.test(model)) {
    throw new TypeError("The Odoo model name is malformed.");
  }
  if (FORBIDDEN_MODELS.has(model)) throw new OdooError("model_not_allowed", { model, method });
  if (typeof apiKey !== "string" || !/^[\x21-\x7e]+$/.test(apiKey)) {
    throw new TypeError("An Odoo API key must be a non-empty printable token.");
  }
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new TypeError("Odoo call parameters must be an object.");
  }
  if (
    method !== "fields_get" &&
    (!Array.isArray(params.fields) ||
      params.fields.length === 0 ||
      params.fields.some((field) => typeof field !== "string" || !FIELD_NAME.test(field)))
  ) {
    throw new OdooError("fields_required", { model, method });
  }
}

// One JSON POST with the timeout, the caller's abort signal and the streamed
// size limit. Transport failures become fixed codes.
async function post(options, path, headers, payload, details) {
  const {
    url,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = MAX_RESPONSE_BYTES,
    fetch: fetchImpl = globalThis.fetch,
  } = options;
  if (signal?.aborted) throw new OdooError("aborted", details);
  const endpoint = `${normalizeBaseUrl(url)}${path}`;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  let text;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
        ...headers,
      },
      body: JSON.stringify(payload),
      signal: combined,
      // A redirect is never followed: Odoo answers a route it does not have
      // with a redirect to its login page.
      redirect: "manual",
    });
    text = await readBody(response, details, maxResponseBytes);
  } catch (error) {
    if (error instanceof OdooError) throw error;
    if (signal?.aborted) throw new OdooError("aborted", details);
    if (timeout.aborted) throw new OdooError("timeout", details);
    throw new OdooError("connection_failed", details);
  }
  const isJson = /^application\/json\b/i.test(response.headers.get("content-type") || "");
  let body;
  if (isJson) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new OdooError("invalid_response", { ...details, status: response.status });
    }
  }
  return { response, isJson, body };
}

async function callOdoo(options) {
  const { database, apiKey, model, method, params = {} } = options || {};
  checkRead({ model, method, params, apiKey });
  const details = { model, method };
  const headers = { Authorization: `bearer ${apiKey}` };
  if (database) headers["X-Odoo-Database"] = database;
  const { response, isJson, body } = await post(
    options,
    `/json/2/${model}/${method}`,
    headers,
    params,
    details,
  );
  if (!response.ok) throw errorForStatus(response, isJson, details);
  if (!isJson) throw new OdooError("invalid_response", { ...details, status: response.status });
  return body;
}

// JSON-RPC reports every failure as HTTP 200 with an error object naming the
// exception class; only that name is used, never the message.
const RPC_ERRORS = {
  "odoo.exceptions.AccessError": "access_denied",
  "odoo.exceptions.AccessDenied": "invalid_api_key",
  "odoo.exceptions.UserError": "invalid_request",
  "odoo.exceptions.ValidationError": "invalid_request",
  "odoo.exceptions.MissingError": "invalid_request",
  "builtins.AttributeError": "invalid_request",
  "builtins.KeyError": "invalid_request",
  "builtins.TypeError": "invalid_request",
  "builtins.ValueError": "invalid_request",
};

let rpcId = 0;

async function rpc(options, service, method, args, details) {
  rpcId += 1;
  const { response, isJson, body } = await post(
    options,
    "/jsonrpc",
    {},
    { jsonrpc: "2.0", method: "call", params: { service, method, args }, id: rpcId },
    details,
  );
  if (!response.ok) {
    const missing =
      (response.status >= 300 && response.status < 400) || (response.status === 404 && !isJson);
    const code = missing ? "jsonrpc_unavailable" : "server_error";
    throw new OdooError(code, { ...details, status: response.status });
  }
  if (!isJson || !body || typeof body !== "object") {
    throw new OdooError("invalid_response", { ...details, status: response.status });
  }
  if (body.error) {
    const name = typeof body.error?.data?.name === "string" ? body.error.data.name : "";
    throw new OdooError(RPC_ERRORS[name] || "server_error", details);
  }
  return body.result;
}

function checkJsonRpcSettings({ database, login }) {
  if (typeof database !== "string" || !/^[A-Za-z0-9_.-]+$/.test(database)) {
    throw new TypeError("JSON-RPC needs the database name.");
  }
  if (typeof login !== "string" || !login || /[\p{Cc}]/u.test(login)) {
    throw new TypeError("JSON-RPC needs the login of the API key's user.");
  }
}

// Resolves the user id once per client through service `common`.
async function authenticateJsonRpc(options) {
  const { database, login, apiKey } = options;
  checkJsonRpcSettings(options);
  const uid = await rpc(options, "common", "authenticate", [database, login, apiKey, {}], {
    method: "authenticate",
  });
  if (!Number.isInteger(uid) || uid <= 0) {
    throw new OdooError("invalid_api_key", { method: "authenticate" });
  }
  return uid;
}

async function callJsonRpc(options) {
  const { database, apiKey, model, method, params = {}, uid } = options || {};
  checkRead({ model, method, params, apiKey });
  checkJsonRpcSettings(options);
  const userId = typeof uid === "function" ? await uid() : uid;
  if (!Number.isInteger(userId)) throw new TypeError("JSON-RPC needs the user id.");
  return rpc(
    options,
    "object",
    "execute_kw",
    [database, userId, apiKey, model, method, [], params],
    { model, method },
  );
}

// Binds connection settings once and pages search_read by id so a large
// catalog arrives in bounded responses in a stable order.
function createOdooClient(settings) {
  const base = { ...settings };
  normalizeBaseUrl(base.url);
  const api = base.api || "json2";
  if (!APIS.has(api)) throw new TypeError("api must be json2 or jsonrpc.");
  const pageSize = base.pageSize || DEFAULT_PAGE_SIZE;
  let call;
  if (api === "json2") {
    call = (model, method, params) => callOdoo({ ...base, model, method, params });
  } else {
    checkJsonRpcSettings(base);
    let session = null;
    const uid = () => {
      session ??= authenticateJsonRpc(base);
      return session;
    };
    call = (model, method, params) => callJsonRpc({ ...base, model, method, params, uid });
  }
  return {
    call,
    fieldsGet(model, attributes) {
      return call(model, "fields_get", { attributes });
    },
    async searchRead(model, { domain = [], fields, context } = {}) {
      const rows = [];
      for (let offset = 0; ; offset += pageSize) {
        const params = { domain, fields, offset, limit: pageSize, order: "id" };
        if (context) params.context = context;
        const page = await call(model, "search_read", params);
        if (!Array.isArray(page)) {
          throw new OdooError("invalid_response", { model, method: "search_read" });
        }
        rows.push(...page);
        if (page.length < pageSize) return rows;
      }
    },
  };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_RESPONSE_BYTES,
  OdooError,
  READ_METHODS,
  authenticateJsonRpc,
  callJsonRpc,
  callOdoo,
  createOdooClient,
  normalizeBaseUrl,
};
