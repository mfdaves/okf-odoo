"use strict";

// Client for the o3p_mcp data API in Odoo: POST {url}/o3p_mcp/api/v1/{op}
// with the resource server's client credentials as HTTP Basic and the
// signed-in user's access token as the subject. Odoo runs the operation as
// that user. Errors carry a fixed code and message: neither Odoo's text nor
// the token or the credentials ever reach a result or an error.

const { setTimeout: sleep } = require("node:timers/promises");
const { OdooError, normalizeBaseUrl, postJson } = require("./odoo");

const OPS = new Set([
  "context",
  "models",
  "describe",
  "search",
  "read",
  "group",
  "sql",
  "create",
  "update",
  "actions",
  "describe_action",
  "run_action",
]);
// The operations that change records: Odoo's own refusal of a write comes
// with the message Odoo shows that user.
const WRITE_OPS = new Set(["create", "update", "run_action"]);
// PostgreSQL's own message about an SQL query, as the data API caps it.
const MAX_SQL_MESSAGE = 500;
// The host passes on detail strings of at most 200 characters.
const MAX_DETAIL = 200;
// Below the host's own per-call limit (30 s in okf-mcp), so the host hears
// this pack's timeout rather than cutting the call off itself.
const DEFAULT_TIMEOUT_MS = 25000;
// Odoo caps a result at 1 MB by default; this only bounds a misbehaving server.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
// too_many_requests means the user's query slots or the server's sandbox
// connections are all taken, which lasts as long as a running query. Agents
// often send several queries at once, so the call waits and asks again
// instead of failing: here, in the host, the wait holds no Odoo worker. It
// gives up after BUSY_WAIT_MS, and never later than leaves the last attempt
// MIN_ATTEMPT_MS of the call's time limit.
const BUSY_WAIT_MS = 12000;
const BUSY_DELAYS_MS = [250, 500, 1000];
const MIN_ATTEMPT_MS = 5000;
const BUSY_HINT =
  "Odoo limits how many SQL queries run at once and stayed busy; send the queries one after another.";

const MESSAGES = {
  // The data API contract.
  invalid_params: "Odoo refused the parameters.",
  invalid_client: "Odoo refused the connector's client credentials.",
  invalid_token: "The signed-in user's access token is not valid for Odoo.",
  insufficient_scope: "The signed-in user's access token does not allow this on Odoo data.",
  access_denied: "The signed-in user may not read or change this.",
  unknown_op: "Odoo does not offer this operation.",
  unknown_model: "Odoo has no such model, or it is not exposed.",
  result_too_large: "The result is too large; ask for fewer records or fields.",
  query_error:
    "Odoo could not run the query or refused the change; check field names, operators and values.",
  too_many_requests: "Too many queries are running for this user or server; try again shortly.",
  unavailable: "SQL queries are not available on this Odoo server right now.",
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
  "too_many_requests",
  "unavailable",
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
    if (details.reply) this.details = details.reply;
    if (details.status) this.status = details.status;
  }
}

function oneLine(value, max) {
  return typeof value === "string"
    ? value
        .toWellFormed()
        .replace(/[\p{Cc}\u2028\u2029]+/gu, " ")
        .trim()
        .slice(0, max) || null
    : null;
}

// What an error answer explains, reduced to bounded scalars the host passes
// on. Every operation may name the offending parameter, the reason and a
// hint, all schema names and fixed texts. sql's query_error adds
// PostgreSQL's answer (the sandbox holds only rows the user may read, and an
// agent needs it to fix its query): a valid SQLSTATE, a 1-based position and
// a message of at most 500 characters. The query_error of create, update
// and run_action adds Odoo's own message for the user, capped the same way. A string
// holding the token or a credential is dropped. Returns null when nothing
// remains.
function errorDetails(value, op, code, hidden) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const clean = (text, max) => {
    const line = oneLine(text, max);
    return line && !hidden.some((secret) => secret && line.includes(secret)) ? line : null;
  };
  const details = {};
  for (const key of ["field", "reason", "hint"]) {
    const text = clean(value[key], MAX_DETAIL);
    if (text) details[key] = text;
  }
  if (op === "sql" && code === "query_error") {
    details.sqlstate =
      typeof value.sqlstate === "string" && /^[0-9A-Z]{5}$/.test(value.sqlstate)
        ? value.sqlstate
        : null;
    details.position =
      Number.isInteger(value.position) && value.position > 0 && value.position <= 1000000
        ? value.position
        : null;
    details.message = clean(value.message, MAX_SQL_MESSAGE);
  }
  if (WRITE_OPS.has(op) && code === "query_error") {
    const message = clean(value.message, MAX_SQL_MESSAGE);
    if (message) details.message = message;
  }
  return Object.keys(details).length ? details : null;
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

// One call: the request, repeated while the data API answers
// too_many_requests, within one time limit (`timeoutMs`) for the whole call.
async function callDataApi(options) {
  const {
    op,
    clientId,
    clientSecret,
    token,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    busyWaitMs = BUSY_WAIT_MS,
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
  const started = Date.now();
  const deadline = started + timeoutMs;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestOnce(options, deadline - Date.now());
    } catch (error) {
      if (error.code !== "too_many_requests") throw error;
      const delay = BUSY_DELAYS_MS[Math.min(attempt, BUSY_DELAYS_MS.length - 1)];
      const resume = Date.now() + delay;
      if (resume - started > busyWaitMs || deadline - resume < MIN_ATTEMPT_MS) {
        throw new OdooToolError("too_many_requests", {
          status: error.status,
          reply: { ...error.details, hint: BUSY_HINT },
        });
      }
      try {
        await sleep(delay, undefined, { signal });
      } catch {
        throw new OdooToolError("aborted");
      }
    }
  }
}

async function requestOnce(options, timeoutMs) {
  const {
    url,
    op,
    clientId,
    clientSecret,
    token,
    params,
    signal,
    maxResponseBytes = MAX_RESPONSE_BYTES,
    fetch,
  } = options;
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
  const code = CONTRACT_CODES.has(body?.error?.code) ? body.error.code : "server_error";
  const explained = errorDetails(body.error.details, op, code, [token, clientId, clientSecret]);
  throw new OdooToolError(code, { status, ...(explained ? { reply: explained } : {}) });
}

module.exports = {
  BUSY_WAIT_MS,
  CONTRACT_CODES,
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_DETAIL,
  MAX_SQL_MESSAGE,
  OdooToolError,
  basicCredentials,
  callDataApi,
};
