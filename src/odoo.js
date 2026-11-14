"use strict";

// Minimal client for Odoo's JSON-2 API (Odoo 19 and later): one POST per call
// to /json/2/<model>/<method> with a bearer API key. Only read methods can be
// called, reads must name the fields they want, and errors carry a fixed code
// and message, never server text.

const READ_METHODS = new Set(["fields_get", "read", "search_read"]);
// Holds system parameters, which may carry credentials; never metadata.
const FORBIDDEN_MODELS = new Set(["ir.config_parameter"]);
const FIELD_NAME = /^[a-z_][a-z0-9_]*$/;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_PAGE_SIZE = 500;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MODEL_NAME = /^[a-z_][a-z0-9_]*(\.[a-z0-9_]+)*$/;

const MESSAGES = {
  aborted: "The Odoo request was aborted.",
  access_denied: "The Odoo API key's user may not read this metadata.",
  connection_failed: "The Odoo server could not be reached.",
  invalid_api_key: "Odoo rejected the API key.",
  invalid_request: "Odoo rejected the request parameters.",
  invalid_response: "Odoo returned a response that is not JSON.",
  json2_unavailable: "The Odoo server offers no JSON-2 API for this database.",
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
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

// The JSON-2 dispatcher answers an unknown model or method with 404 and a JSON
// error body; a server without the route (Odoo 18 and older, or no rpc module)
// answers 404 with an HTML page, so only the content type tells them apart.
function errorForStatus(response, isJson, details) {
  const status = response.status;
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

async function readBody(response, details) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    throw new OdooError("response_too_large", details);
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw new OdooError("response_too_large", details);
  }
  return text;
}

async function callOdoo(options) {
  const {
    url,
    database,
    apiKey,
    model,
    method,
    params = {},
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetch: fetchImpl = globalThis.fetch,
  } = options || {};
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
  const details = { model, method };
  if (signal?.aborted) throw new OdooError("aborted", details);

  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const headers = {
    Authorization: `bearer ${apiKey}`,
    "Content-Type": "application/json; charset=utf-8",
    Accept: "application/json",
  };
  if (database) headers["X-Odoo-Database"] = database;

  const endpoint = `${normalizeBaseUrl(url)}/json/2/${model}/${method}`;
  let response;
  let text;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(params),
      signal: combined,
      redirect: "error",
    });
    text = await readBody(response, details);
  } catch (error) {
    if (error instanceof OdooError) throw error;
    if (signal?.aborted) throw new OdooError("aborted", details);
    if (timeout.aborted) throw new OdooError("timeout", details);
    throw new OdooError("connection_failed", details);
  }

  const isJson = /^application\/json\b/i.test(response.headers.get("content-type") || "");
  if (!response.ok) throw errorForStatus(response, isJson, details);
  if (!isJson) throw new OdooError("invalid_response", { ...details, status: response.status });
  try {
    return JSON.parse(text);
  } catch {
    throw new OdooError("invalid_response", { ...details, status: response.status });
  }
}

// Binds connection settings once and pages search_read by id so a large
// catalog arrives in bounded responses in a stable order.
function createOdooClient(settings) {
  const base = { ...settings };
  normalizeBaseUrl(base.url);
  const pageSize = base.pageSize || DEFAULT_PAGE_SIZE;
  const call = (model, method, params) => callOdoo({ ...base, model, method, params });
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
  OdooError,
  READ_METHODS,
  callOdoo,
  createOdooClient,
  normalizeBaseUrl,
};
