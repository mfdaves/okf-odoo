"use strict";

// The server, protocol and credentials scripts/live-odoo.sh prints, for the
// live gates and the fixture recorder.

const { createOdooClient } = require("../../src/odoo");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; start the server with scripts/live-odoo.sh.`);
  return value;
}

function liveApi() {
  return process.env.OKF_ODOO_API || "json2";
}

// Producer configuration for the live server: the protocol, the database and,
// over JSON-RPC, the login of the key's user.
function liveConnection(loginVariable = "OKF_ODOO_LOGIN") {
  const api = liveApi();
  const connection = {
    url: required("OKF_ODOO_URL"),
    database: required("OKF_ODOO_DATABASE"),
  };
  if (api === "jsonrpc") Object.assign(connection, { api, login: required(loginVariable) });
  return connection;
}

function liveClient(keyVariable = "OKF_ODOO_API_KEY", loginVariable = "OKF_ODOO_LOGIN") {
  return createOdooClient({
    ...liveConnection(loginVariable),
    apiKey: required(keyVariable),
  });
}

module.exports = { liveApi, liveClient, liveConnection, required };
