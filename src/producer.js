"use strict";

// Producer API v1 descriptor for okf-mcp and other hosts: validateConfig()
// checks and normalises the trusted project configuration, generate() reads
// the catalog and returns candidate files without writing anything.

const packageJson = require("../package.json");
const { DEFAULT_SECTIONS, MODEL_SECTIONS, SECTIONS, readCatalog } = require("./catalog");
const { createOdooClient, normalizeBaseUrl } = require("./odoo");
const { RELATION_TYPES, buildBundle, normalizeGeneratedAt } = require("./render");

const CONFIG_KEYS = new Set([
  "url",
  "api",
  "database",
  "login",
  "apiKeyEnv",
  "source",
  "lang",
  "sections",
  "modules",
  "otherModules",
]);
const IDENTIFIER = /^[A-Za-z0-9_.-]+$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LANG = /^[a-z]{2,3}(_[A-Za-z0-9]{2,4})?(@[a-z]+)?$/;
const MODULE_PATTERN = /^[a-z0-9_*]+$/;
const OTHER_MODULES = new Set(["summary", "none"]);
const APIS = new Set(["json2", "jsonrpc"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateConfig(value = {}) {
  const diagnostics = [];
  const report = (code, field, message) => diagnostics.push({ code, field, message });
  const input = isPlainObject(value) ? value : {};
  if (!isPlainObject(value))
    report("invalid_config", "config", "Producer config must be an object.");
  for (const key of Object.keys(input)
    .filter((name) => !CONFIG_KEYS.has(name))
    .sort()) {
    report("unknown_config_key", key, `Unsupported Odoo producer config key: ${key}.`);
  }

  let url = null;
  if (input.url === undefined) {
    report("missing_url", "url", "url is required.");
  } else {
    try {
      url = normalizeBaseUrl(input.url);
    } catch {
      report(
        "invalid_url",
        "url",
        "url must be an https URL (http only for a loopback host) without credentials, query, or fragment.",
      );
    }
  }

  // The protocol is configured, never guessed: JSON-2 for Odoo 19 and later,
  // JSON-RPC for Odoo 18, which also needs the database and the key's login.
  const api = input.api === undefined ? "json2" : input.api;
  if (!APIS.has(api)) report("invalid_api", "api", "api must be json2 or jsonrpc.");

  const database = input.database === undefined ? null : input.database;
  if (database !== null && (typeof database !== "string" || !IDENTIFIER.test(database))) {
    report("invalid_database", "database", "database must be an Odoo database name.");
  } else if (database === null && api === "jsonrpc") {
    report("missing_database", "database", "database is required with api jsonrpc.");
  }

  const login = input.login === undefined ? null : input.login;
  if (login !== null && (typeof login !== "string" || !login.trim() || /\p{Cc}/u.test(login))) {
    report("invalid_login", "login", "login must be the login of the API key's user.");
  } else if (login === null && api === "jsonrpc") {
    report("missing_login", "login", "login is required with api jsonrpc.");
  } else if (login !== null && api !== "jsonrpc") {
    report("login_requires_jsonrpc", "login", "login is used only with api jsonrpc.");
  }

  // Required: a host such as okf-mcp hands over only the secrets whose
  // variable names appear in the configuration it was given.
  const apiKeyEnv = input.apiKeyEnv === undefined ? null : input.apiKeyEnv;
  if (apiKeyEnv === null) {
    report("missing_api_key_env", "apiKeyEnv", "apiKeyEnv is required.");
  } else if (typeof apiKeyEnv !== "string" || !ENV_NAME.test(apiKeyEnv)) {
    report("invalid_api_key_env", "apiKeyEnv", "apiKeyEnv must be an environment-variable name.");
  }

  const source = input.source === undefined ? "odoo" : input.source;
  if (typeof source !== "string" || !IDENTIFIER.test(source)) {
    report(
      "invalid_source",
      "source",
      "source may contain only letters, numbers, dots, underscores, and hyphens.",
    );
  }

  const lang = input.lang === undefined ? "en_US" : input.lang;
  if (typeof lang !== "string" || !LANG.test(lang)) {
    report("invalid_lang", "lang", "lang must be an Odoo language code such as en_US.");
  }

  let sections = [...DEFAULT_SECTIONS];
  if (input.sections !== undefined) {
    if (
      !Array.isArray(input.sections) ||
      input.sections.length === 0 ||
      input.sections.some((section) => !SECTIONS.includes(section))
    ) {
      report("invalid_sections", "sections", `sections must list some of: ${SECTIONS.join(", ")}.`);
    } else {
      sections = SECTIONS.filter((section) => input.sections.includes(section));
      const orphan = MODEL_SECTIONS.find(
        (section) => sections.includes(section) && !sections.includes("models"),
      );
      if (orphan) {
        report(
          "section_requires_models",
          "sections",
          `The ${orphan} section is rendered on model concepts and requires the models section.`,
        );
      }
    }
  }

  const modules = { include: [], exclude: [] };
  if (input.modules !== undefined) {
    if (!isPlainObject(input.modules)) {
      report("invalid_modules", "modules", "modules must be a mapping with include and exclude.");
    } else {
      for (const key of Object.keys(input.modules).sort()) {
        if (key !== "include" && key !== "exclude") {
          report("unknown_config_key", `modules.${key}`, `Unsupported modules key: ${key}.`);
          continue;
        }
        const patterns = input.modules[key];
        if (
          !Array.isArray(patterns) ||
          patterns.some((pattern) => typeof pattern !== "string" || !MODULE_PATTERN.test(pattern))
        ) {
          report(
            "invalid_module_patterns",
            `modules.${key}`,
            `modules.${key} must list module names; * matches any characters.`,
          );
        } else {
          modules[key] = [...new Set(patterns)].sort();
        }
      }
    }
  }

  const otherModules = input.otherModules === undefined ? "summary" : input.otherModules;
  if (!OTHER_MODULES.has(otherModules)) {
    report("invalid_other_modules", "otherModules", "otherModules must be summary or none.");
  }

  return {
    valid: diagnostics.length === 0,
    config: {
      url,
      api,
      database,
      login,
      apiKeyEnv,
      source,
      lang,
      sections,
      modules,
      otherModules,
    },
    diagnostics,
  };
}

function requireValidConfig(value) {
  const validation = validateConfig(value);
  if (!validation.valid) {
    const error = new Error(validation.diagnostics.map((entry) => entry.message).join(" "));
    error.code = "invalid_config";
    error.diagnostics = validation.diagnostics;
    throw error;
  }
  return validation.config;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Odoo production was aborted.");
  }
}

function summarize(catalog, files) {
  const models = catalog.models;
  const count = (list) => models.reduce((total, model) => total + model[list].length, 0);
  return {
    apps: catalog.apps.length,
    accessEntries: count("access"),
    fields: count("fields"),
    files: files.size,
    groups: catalog.groups.length,
    models: models.length,
    modules: catalog.modules.length,
    reports: count("reports"),
    scheduledJobs: count("crons"),
    serverActions: count("serverActions"),
  };
}

async function generateOdoo(context = {}, dependencies = {}) {
  const config = requireValidConfig(context.config || {});
  const bundle = String(context.bundleId || "").trim();
  if (!IDENTIFIER.test(bundle)) {
    throw new Error("bundleId may contain only letters, numbers, dots, underscores, and hyphens.");
  }
  throwIfAborted(context.signal);
  if (typeof context.getSecret !== "function") {
    throw new Error("Odoo production requires getSecret(name).");
  }
  const apiKey = await context.getSecret(config.apiKeyEnv);
  if (typeof apiKey !== "string" || !apiKey) {
    throw new Error(`API key environment variable ${config.apiKeyEnv} is empty.`);
  }
  const generatedAt = normalizeGeneratedAt(
    context.generatedAt === undefined ? new Date() : context.generatedAt,
  );
  const createClient = dependencies.createClient || createOdooClient;
  const client = createClient({
    api: config.api,
    url: config.url,
    database: config.database,
    login: config.login,
    apiKey,
    signal: context.signal,
  });
  const catalog = await readCatalog(client, {
    sections: config.sections,
    modules: config.modules,
    otherModules: config.otherModules,
    lang: config.lang,
  });
  throwIfAborted(context.signal);
  const files = buildBundle(catalog, {
    source: config.source,
    bundle,
    generatedAt,
    producerVersion: packageJson.version,
  });
  return {
    files: [...files.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([path, content]) => ({ path, content })),
    summary: summarize(catalog, files),
  };
}

const okfProducer = Object.freeze({
  apiVersion: "1",
  okfVersion: "0.2",
  id: "odoo",
  name: "okf-odoo",
  version: packageJson.version,
  relationTypes: RELATION_TYPES,
  validateConfig,
  generate: generateOdoo,
});

module.exports = {
  generateOdoo,
  odooProducer: okfProducer,
  okfProducer,
  validateConfig,
};
