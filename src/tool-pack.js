"use strict";

// The only module that knows the host's tool-pack interface (okf-mcp tool-pack
// API v1, experimental): `okfToolPack = { apiVersion, id, validateConfig,
// tools }`, tools keyed by name, each `{ description, annotations,
// inputSchema, outputSchema, scope, handler(args, ctx) }` with
// `ctx = { principal, subjectToken, config, getSecret, signal }`. Every tool
// declares `requiresSubjectToken`, so the host hides it where no signed-in
// user's token exists (stdio, unauthenticated HTTP). If the host changes that
// shape, only this file changes.

const { SCOPE, TOOLS, annotations, runTool, validateConfig } = require("./tools");

function createOdooToolPack(dependencies = {}) {
  const tools = {};
  for (const tool of TOOLS) {
    tools[tool.name] = Object.freeze({
      description: tool.description,
      annotations: Object.freeze(annotations(tool.title)),
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      scope: SCOPE,
      requiresSubjectToken: true,
      // The principal is not needed: Odoo identifies the user by the token.
      handler: (args, ctx = {}) =>
        runTool(
          tool,
          args,
          {
            subjectToken: ctx.subjectToken,
            config: ctx.config,
            getSecret: ctx.getSecret,
            signal: ctx.signal,
          },
          dependencies,
        ),
    });
  }
  return Object.freeze({
    apiVersion: "1",
    id: "odoo",
    validateConfig,
    tools: Object.freeze(tools),
  });
}

const okfToolPack = createOdooToolPack();

module.exports = { createOdooToolPack, okfToolPack };
