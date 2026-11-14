"use strict";

const http = require("node:http");

// The exception names Odoo's JSON-RPC errors carry for the JSON-2 statuses a
// handler replies with.
const RPC_EXCEPTIONS = {
  401: "odoo.exceptions.AccessDenied",
  403: "odoo.exceptions.AccessError",
  404: "odoo.exceptions.UserError",
  422: "odoo.exceptions.UserError",
};

function rpcError(name) {
  return {
    code: 200,
    message: "Odoo Server Error",
    data: { name, message: "server text", arguments: ["server text"], context: {}, debug: "" },
  };
}

// An Odoo stand-in on node:http serving JSON-2 (/json/2/<model>/<method>) and
// JSON-RPC (/jsonrpc). `handle({ model, method, params, headers })` returns
// { status, body, contentType } or a JSON-serialisable result; over JSON-RPC
// `params` are the execute_kw keyword arguments and an error status becomes
// the matching exception. `jsonrpc` holds the database, login, API key and uid
// the fake accepts. Every request is recorded.
async function startFakeOdoo(handle, { jsonrpc } = {}) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (request.url === "/jsonrpc") {
        await serveJsonRpc(raw, request, response);
        return;
      }
      const match = request.url.match(/^\/json\/2\/([^/]+)\/([^/?]+)$/);
      const entry = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        raw,
        model: match ? match[1] : null,
        rpc: match ? match[2] : null,
        params: null,
      };
      try {
        entry.params = raw ? JSON.parse(raw) : null;
      } catch {
        entry.params = undefined;
      }
      requests.push(entry);
      const reply = await handle({
        model: entry.model,
        method: entry.rpc,
        params: entry.params,
        headers: request.headers,
        url: request.url,
      });
      if (reply === undefined) return; // never answer: lets tests time out
      send(response, shape(reply));
    });
  });

  async function serveJsonRpc(raw, request, response) {
    let envelope = null;
    try {
      envelope = JSON.parse(raw);
    } catch {
      envelope = null;
    }
    const { service, method, args = [] } = envelope?.params || {};
    const entry = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      raw,
      service,
      rpc: method,
      args,
      model: service === "object" ? args[3] : null,
      params: service === "object" ? args[6] : null,
    };
    if (service === "object") entry.rpc = args[4];
    requests.push(entry);
    const answer = (payload) =>
      send(response, { body: { jsonrpc: "2.0", id: envelope?.id ?? null, ...payload } });
    if (!jsonrpc) return send(response, { status: 404, contentType: "text/html", body: "<html>" });
    if (service === "common" && method === "authenticate") {
      const [database, login, key] = args;
      if (database !== jsonrpc.database) {
        return answer({ error: rpcError("psycopg2.OperationalError") });
      }
      return answer({
        result: login === jsonrpc.login && key === jsonrpc.apiKey ? jsonrpc.uid : false,
      });
    }
    if (service !== "object" || method !== "execute_kw") {
      return answer({ error: rpcError("builtins.AttributeError") });
    }
    const [database, uid, key, model, rpcMethod, , kwargs] = args;
    if (database !== jsonrpc.database || uid !== jsonrpc.uid || key !== jsonrpc.apiKey) {
      return answer({ error: rpcError("odoo.exceptions.AccessDenied") });
    }
    const reply = await handle({
      model,
      method: rpcMethod,
      params: kwargs,
      headers: request.headers,
      url: request.url,
    });
    if (reply === undefined) return undefined;
    const shaped = shape(reply);
    if (shaped.contentType && !shaped.contentType.startsWith("application/json")) {
      return send(response, shaped);
    }
    const status = shaped.status || 200;
    if (status >= 400) {
      return answer({ error: rpcError(RPC_EXCEPTIONS[status] || "builtins.Exception") });
    }
    return answer({ result: shaped.body === undefined ? null : shaped.body });
  }
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// The JSON body Odoo's JSON-2 controller sends with an error status.
function odooError(status, name, message) {
  return { status, body: { name, message, arguments: [message], context: {}, debug: "" } };
}

function shape(reply) {
  return reply && typeof reply === "object" && "status" in reply ? reply : { body: reply };
}

function send(response, shaped) {
  const contentType = shaped.contentType || "application/json; charset=utf-8";
  const body =
    typeof shaped.body === "string" && !contentType.startsWith("application/json")
      ? shaped.body
      : JSON.stringify(shaped.body === undefined ? null : shaped.body);
  response.writeHead(shaped.status || 200, { "Content-Type": contentType });
  response.end(body);
}

module.exports = { odooError, startFakeOdoo };
