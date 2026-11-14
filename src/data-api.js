"use strict";

// Client for the o3p_mcp data API in Odoo: POST {url}/o3p_mcp/api/v1/{op}
// with the resource server's client credentials as HTTP Basic and the
// signed-in user's access token as the subject. Odoo runs the operation as
// that user. Errors carry a fixed code and message: neither Odoo's text nor
// the token or the credentials ever reach a result or an error.

const { OdooError, normalizeBaseUrl, postJson } = require("./odoo");

const OPS = new Set(["models", "describe", "search", "read", "group"]);
// Below the host's own per-call limit (30 s in okf-mcp), so the host hears
// this pack's timeout rather than cutting the call off itself.
const DEFAULT_TIMEOUT_MS = 25000;
// Odoo caps a result at 1 MB by default; this only bounds a misbehaving server.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const MESSAGES = {
  // The data API contract.
  invalid_params: "Odoo refused the parameters.",
  invalid_client: "Odoo refused the connector's client credentials.",
  invalid_token: "The signed-in user's access token is not valid for Odoo.",
  insufficient_scope: "The signed-in user's access token does not allow reading Odoo data.",
  access_denied: "The signed-in user may not read this.",
  unknown_op: "Odoo does not offer this operation.",
  unknown_model: "Odoo has no such model, or it is not exposed.",
  result_too_large: "The result is too large; ask for fewer records or fields.",
  query_error: "Odoo could not run the query; check field names, operators and values.",
  timeout: "The query took too long.",
  // The connector.
  aborted: "The request was cancelled.",
  client_credentials_unavailable: "The connector's client credentials are not configured.",
  connection_failed: "Odoo could not be reached.",
  data_api_unavailable: "This Odoo server offers no MCP data API.",
  invalid_arguments: "The tool arguments do not match its input schema.",
  invalid_config: "The connector's Odoo tool configuration is not valid.",
  invalid_response: "Odoo returned an answer that could not be read.",
  server_error: "Odoo failed to answer.",
  subject_token_required:
    "Odoo data tools need a signed-in user; they are available over HTTP only.",
};

const CONTRACT_CODES = new Set([
  "invalid_params",
  "invalid_client",
  "invalid_token",
  "insufficient_scope",
  "access_denied",
  "unknown_op",
  "unknown_model",
  "result_too_large",
  "query_error",
  "timeout",
]);

class OdooToolError extends Error {
  constructor(code, details = {}) {
    super(MESSAGES[code] || MESSAGES.server_error);
    this.name = "OdooToolError";
    this.code = MESSAGES[code] ? code : "server_error";
    // `details` is what a host may pass on: bounded scalars naming the
    // caller's own parameter, never a value. The HTTP status stays local.
    if (details.field) {
      this.details = { field: details.field.split("/")[1] || null, path: details.field };
    }
    if (details.status) this.status = details.status;
  }
}

// RFC 6749 section 2.3.1: client id and secret are form-urlencoded before
// they are joined and base64-encoded.
function formEncode(value) {
  return new URLSearchParams([["", value]]).toString().slice(1);
}

function basicCredentials(clientId, clientSecret) {
  const pair = `${formEncode(clientId)}:${formEncode(clientSecret)}`;
  return `Basic ${Buffer.from(pair, "utf8").toString("base64")}`;
}

// Transport failures of the shared client, as tool codes.
const TRANSPORT = {
  aborted: "aborted",
  timeout: "timeout",
  connection_failed: "connection_failed",
  response_too_large: "result_too_large",
  invalid_response: "invalid_response",
};

async function callDataApi(options) {
  const {
    url,
    op,
    clientId,
    clientSecret,
    token,
    params,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = MAX_RESPONSE_BYTES,
    fetch,
  } = options;
  if (!OPS.has(op)) throw new OdooToolError("unknown_op");
  if (typeof token !== "string" || !token) throw new OdooToolError("subject_token_required");
  if (
    typeof clientId !== "string" ||
    !clientId ||
    typeof clientSecret !== "string" ||
    !clientSecret
  ) {
    throw new OdooToolError("client_credentials_unavailable");
  }
  let reply;
  try {
    reply = await postJson(
      { url: normalizeBaseUrl(url), signal, timeoutMs, maxResponseBytes, fetch },
      `/o3p_mcp/api/v1/${op}`,
      { Authorization: basicCredentials(clientId, clientSecret) },
      { token, params },
      {},
    );
  } catch (error) {
    if (error instanceof OdooError)
      throw new OdooToolError(TRANSPORT[error.code] || "server_error");
    throw new OdooToolError("server_error");
  }
  const { response, isJson, body } = reply;
  const status = response.status;
  if (status >= 300 && status < 400) throw new OdooToolError("data_api_unavailable", { status });
  if (!isJson) {
    throw new OdooToolError(status === 404 ? "data_api_unavailable" : "invalid_response", {
      status,
    });
  }
  if (response.ok) {
    if (!body || typeof body !== "object" || !Object.hasOwn(body, "result")) {
      throw new OdooToolError("invalid_response", { status });
    }
    return body.result;
  }
  const code = body?.error?.code;
  throw new OdooToolError(CONTRACT_CODES.has(code) ? code : "server_error", { status });
}

module.exports = {
  CONTRACT_CODES,
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  OdooToolError,
  basicCredentials,
  callDataApi,
};
