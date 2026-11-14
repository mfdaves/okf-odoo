"use strict";

const http = require("node:http");

// A JSON-2 stand-in on node:http. `handle({ model, method, params, headers })`
// returns { status, body, contentType } or a JSON-serialisable result. Every
// request is recorded so tests can assert path, headers, and body.
async function startFakeOdoo(handle) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      const raw = Buffer.concat(chunks).toString("utf8");
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
      const shaped =
        reply && typeof reply === "object" && "status" in reply ? reply : { body: reply };
      const contentType = shaped.contentType || "application/json; charset=utf-8";
      const body =
        typeof shaped.body === "string" && !contentType.startsWith("application/json")
          ? shaped.body
          : JSON.stringify(shaped.body === undefined ? null : shaped.body);
      response.writeHead(shaped.status || 200, { "Content-Type": contentType });
      response.end(body);
    });
  });
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

module.exports = { odooError, startFakeOdoo };
