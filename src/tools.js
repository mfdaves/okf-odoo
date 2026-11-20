"use strict";

// The Odoo data tools: their schemas, descriptions and how each maps to an
// operation of the o3p_mcp data API. Host-independent; src/tool-pack.js
// adapts them to the host's tool-pack interface.

const { DEFAULT_TIMEOUT_MS, OdooToolError, callDataApi } = require("./data-api");
const { normalizeBaseUrl } = require("./odoo");
const { violation } = require("./schema");

const SCOPE = "odoo.read";
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CONFIG_KEYS = new Set(["url", "clientIdEnv", "clientSecretEnv", "timeoutMs"]);

const MODEL = {
  type: "string",
  pattern: "^[a-z_][a-z0-9_]*(\\.[a-z0-9_]+)*$",
  maxLength: 128,
  description: "Technical model name, for example res.partner.",
};
const FIELD = { type: "string", pattern: "^[a-z_][a-z0-9_]*$", maxLength: 128 };
const FIELDS = {
  type: "array",
  items: FIELD,
  minItems: 1,
  maxItems: 100,
  description: "Field names to return. Ask only for the fields you need.",
};
const OPERATORS = [
  "=",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "=?",
  "in",
  "not in",
  "like",
  "not like",
  "ilike",
  "not ilike",
  "=like",
  "=ilike",
  "any",
  "not any",
];
const DOMAIN = {
  type: "array",
  maxItems: 100,
  description:
    'Odoo domain: a list of [field, operator, value] conditions, all of which must hold. Put "|" before two conditions for OR, "!" before one for NOT. A field may follow relations with dots, at most 4 fields long (partner_id.country_id.code).',
  items: {
    anyOf: [
      { type: "string", enum: ["&", "|", "!"] },
      {
        type: "array",
        minItems: 3,
        maxItems: 3,
        prefixItems: [
          // At most 4 hops: the data API refuses longer paths.
          {
            type: "string",
            pattern: "^[a-z_][a-z0-9_]*(\\.[a-z_][a-z0-9_]*){0,3}$",
            maxLength: 256,
          },
          { type: "string", enum: OPERATORS },
          {},
        ],
      },
    ],
  },
};
// Sort orders as the data API accepts them: fields of the model for search,
// groupby fields, aggregates or __count for group.
const ORDER_ITEM = "( (asc|desc|ASC|DESC))?";
const SEARCH_ORDER = {
  type: "string",
  maxLength: 200,
  pattern: `^[a-z_][a-z0-9_]*${ORDER_ITEM}(, ?[a-z_][a-z0-9_]*${ORDER_ITEM}){0,9}$`,
  description: 'Sort order on fields of the model, for example "date desc, id".',
};
const GROUP_KEY = "(__count|[a-z_][a-z0-9_]*(:[a-z_]+)?)";
const GROUP_ORDER = {
  type: "string",
  maxLength: 200,
  pattern: `^${GROUP_KEY}${ORDER_ITEM}(, ?${GROUP_KEY}${ORDER_ITEM}){0,9}$`,
  description: 'Sort order on groupby or aggregate items, for example "amount_total:sum desc".',
};
const RECORDS = { type: "array", items: { type: "object" } };

function objectSchema(properties, required) {
  return { type: "object", properties, required, additionalProperties: false };
}

function annotations(title) {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };
}

const RIGHTS =
  "Odoo runs every call as the signed-in user: results contain only what that user may read under Odoo's access rights and record rules, so another user may see different records.";
// Results follow one user's Odoo access, knowledge written from them is read
// by everyone.
const SHARING =
  "These results are limited to the signed-in user's own Odoo access, but knowledge written from them is readable by every MCP user: record conclusions and aggregates, not personal or confidential values (names of individuals, salaries, health or contact details) that other readers could not see in Odoo.";
const FIELD_FLAGS =
  "Filter only on fields odoo_describe_model marks searchable, sort only on sortable ones and group only on groupable ones.";
const EXPLAINED =
  "When Odoo refuses a call (invalid_params, unknown_model, access_denied), the error's details name the parameter (field), the reason and a hint: read them and correct the call.";
const LOOK_UP_FIRST =
  "Before searching, look up the model in the generated `odoo` knowledge bundle (its models/<model> concept lists the fields, relations and access rules) or call odoo_describe_model, so that you use real field names.";

const TOOLS = [
  {
    name: "odoo_context",
    op: "context",
    title: "Who and where am I in Odoo",
    description: [
      "Tell who the signed-in Odoo user is and in which setting the other tools answer: the user (id, name, login), the language and time zone of the answers, the user's default company and all the user's companies, the current time in UTC (now) and today's date in the user's time zone (today).",
      'Call it once before questions about "my" records (filter on the user\'s id), about relative dates such as today or this month, or about one company.',
      "It takes no arguments and tells nothing about other users. A server with o3p_mcp older than 1.42 answers unknown_op.",
    ].join(" "),
    inputSchema: objectSchema({}, []),
    outputSchema: {
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            login: { type: "string" },
          },
          required: ["id", "name"],
        },
        lang: { type: "string" },
        tz: { type: "string" },
        company: {
          type: "object",
          properties: { id: { type: "integer" }, name: { type: "string" } },
          required: ["id", "name"],
        },
        companies: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "integer" }, name: { type: "string" } },
            required: ["id", "name"],
          },
        },
        now: { type: "string" },
        today: { type: "string" },
      },
      required: ["user", "tz", "company", "companies"],
    },
    params: () => ({}),
    result: objectResult,
  },
  {
    name: "odoo_find_models",
    op: "models",
    title: "Find Odoo models",
    description: [
      "Find the Odoo models (business object types, such as res.partner for contacts) that the signed-in user may read, matching a word in the technical name or the label.",
      "Use it when you do not know which model holds the data. The `odoo` knowledge bundle describes the models too, with their fields and access rules.",
      "total is the number of matching models and truncated is true when more exist than limit; page with offset.",
      "Odoo sometimes pairs a restricted model with a public one that more users may read, for example hr.employee.public next to hr.employee: when a model is denied, look for such a public counterpart.",
      RIGHTS,
    ].join(" "),
    inputSchema: objectSchema(
      {
        query: {
          type: "string",
          maxLength: 200,
          description: "Word to look for in the model name or label; omit to list models.",
        },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "At most 50; default 50." },
        offset: {
          type: "integer",
          minimum: 0,
          maximum: 100000,
          description: "Models to skip, for paging.",
        },
      },
      [],
    ),
    outputSchema: {
      type: "object",
      properties: {
        models: {
          type: "array",
          items: {
            type: "object",
            properties: { model: { type: "string" }, name: { type: "string" } },
            required: ["model", "name"],
          },
        },
        total: { type: "integer" },
        truncated: { type: "boolean" },
      },
      required: ["models"],
    },
    params: (args) => ({ ...args }),
    // Older servers answer with the bare list, newer ones with { models,
    // total, truncated }.
    result: (value) =>
      Array.isArray(value) ? { models: value } : Array.isArray(value?.models) ? value : null,
  },
  {
    name: "odoo_describe_model",
    op: "describe",
    title: "Describe an Odoo model",
    description: [
      "List the fields of one Odoo model as the signed-in user sees them: technical name, label, type, related model, whether it is required or read-only, selection values and help text.",
      "Call it, or read the model's concept in the `odoo` knowledge bundle, before odoo_search, odoo_read, odoo_group or odoo_sql. Fields the user may not read are left out.",
      "When the server provides it, table is the model's database table for odoo_sql; it is not always the model name with dots replaced by underscores.",
      "Each field says whether it is stored, searchable (usable in a domain), sortable (usable in order) and groupable (usable in odoo_group's groupby); use fields only where they are marked so.",
      EXPLAINED,
    ].join(" "),
    inputSchema: objectSchema({ model: MODEL }, ["model"]),
    outputSchema: {
      type: "object",
      properties: {
        model: { type: "string" },
        name: { type: "string" },
        table: { type: ["string", "null"] },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              string: { type: "string" },
              type: { type: "string" },
              relation: { type: "string" },
              required: { type: "boolean" },
              readonly: { type: "boolean" },
              stored: { type: "boolean" },
              searchable: { type: "boolean" },
              sortable: { type: "boolean" },
              groupable: { type: "boolean" },
              selection: { type: "array" },
              help: { type: "string" },
            },
            required: ["name", "type"],
          },
        },
      },
      required: ["model", "fields"],
    },
    params: (args) => ({ ...args }),
    result: objectResult,
  },
  {
    name: "odoo_search",
    op: "search",
    title: "Search Odoo records",
    description: [
      "Search records of one Odoo model and return the requested fields of each.",
      LOOK_UP_FIRST,
      FIELD_FLAGS,
      EXPLAINED,
      'The domain is a list of [field, operator, value] conditions that must all hold; put "|" before two conditions for OR. Examples: [["state", "=", "done"], ["date", ">=", "2026-01-01"]] and ["|", ["name", "ilike", "chair"], ["default_code", "=", "A100"]].',
      'Operators: =, !=, >, >=, <, <=, in, not in, like, ilike, not ilike, =like, =ilike, any; the hierarchy operators child_of and parent_of are not available. A text condition on a relation, such as ["partner_id", "ilike", "north"], matches the related record\'s display name among records the user may read; compare ids for exact matches. A field path follows at most 4 fields (partner_id.country_id.code). A many2one value comes back as [id, display name].',
      "On models whose reads hide part of a record (such as private calendar events), filters, sorting and grouping may use only id and the public fields; others are refused with invalid_params.",
      "count is the number of matching records; truncated is true when more exist than limit (at most 200); page with offset. For totals use odoo_group instead of adding up pages.",
      RIGHTS,
      SHARING,
    ].join(" "),
    inputSchema: objectSchema(
      {
        model: MODEL,
        domain: DOMAIN,
        fields: FIELDS,
        order: SEARCH_ORDER,
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "At most 200; default 80.",
        },
        offset: { type: "integer", minimum: 0, maximum: 1000000, description: "Records to skip." },
      },
      ["model", "fields"],
    ),
    outputSchema: {
      type: "object",
      properties: {
        records: RECORDS,
        count: { type: "integer" },
        truncated: { type: "boolean" },
      },
      required: ["records"],
    },
    params: (args) => ({ domain: [], limit: 80, ...args }),
    result: objectResult,
  },
  {
    name: "odoo_read",
    op: "read",
    title: "Read Odoo records",
    description: [
      "Read the requested fields of Odoo records by id (at most 100), for example ids returned by odoo_search or the id in a many2one value [id, display name].",
      LOOK_UP_FIRST,
      EXPLAINED,
      "Ids that do not exist and records the signed-in user may not read are silently left out, so fewer records than ids may come back.",
      SHARING,
    ].join(" "),
    inputSchema: objectSchema(
      {
        model: MODEL,
        ids: {
          type: "array",
          items: { type: "integer", minimum: 1 },
          minItems: 1,
          maxItems: 100,
          description: "Record ids, at most 100.",
        },
        fields: FIELDS,
      },
      ["model", "ids", "fields"],
    ),
    outputSchema: {
      type: "object",
      properties: { records: RECORDS },
      required: ["records"],
    },
    params: (args) => ({ ...args }),
    result: objectResult,
  },
  {
    name: "odoo_group",
    op: "group",
    title: "Group and total Odoo records",
    description: [
      "Group the records of one Odoo model and compute totals, like a pivot table.",
      LOOK_UP_FIRST,
      FIELD_FLAGS,
      EXPLAINED,
      'groupby lists fields; a date field needs a granularity: "date:month" (day, week, month, quarter, year, or hour for date-times). aggregates are written "field:function": sum, avg, min or max on numeric fields, count or count_distinct on stored fields, and "__count" counts records. Example: groupby ["partner_id"], aggregates ["amount_total:sum", "__count"], order "amount_total:sum desc".',
      "Leave groupby out for one group holding the totals over all matching records.",
      "Each group carries its groupby values and aggregates: a relation as [id, display name], a date bucket as [start, label]. A date bucket is a period in the user's time zone (see odoo_context) and start is its beginning in UTC, which can fall on the day before: read the period from the label.",
      "The domain has the same syntax as in odoo_search, with paths of at most 4 fields. At most 500 groups.",
      `${RIGHTS} Totals therefore cover only the records the user may read.`,
      SHARING,
    ].join(" "),
    inputSchema: objectSchema(
      {
        model: MODEL,
        domain: DOMAIN,
        groupby: {
          type: "array",
          items: {
            type: "string",
            pattern: "^[a-z_][a-z0-9_]*(:(hour|day|week|month|quarter|year))?$",
            maxLength: 140,
          },
          maxItems: 5,
          description:
            'Fields to group by, for example ["partner_id", "date:month"]; leave out for totals only.',
        },
        aggregates: {
          type: "array",
          items: {
            type: "string",
            pattern: "^(__count|[a-z_][a-z0-9_]*:(sum|avg|min|max|count|count_distinct))$",
            maxLength: 160,
          },
          minItems: 1,
          maxItems: 20,
          description: 'Totals to compute, for example ["amount_total:sum", "__count"].',
        },
        order: GROUP_ORDER,
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          description: "At most 500; default 80.",
        },
      },
      ["model", "aggregates"],
    ),
    outputSchema: {
      type: "object",
      properties: { groups: RECORDS },
      required: ["groups"],
    },
    params: (args) => ({ domain: [], limit: 80, ...args }),
    result: objectResult,
  },
  {
    name: "odoo_sql",
    op: "sql",
    scope: "odoo.sql",
    title: "Query Odoo with SQL",
    description: [
      "Run one read-only PostgreSQL query on Odoo's tables: a single SELECT, VALUES or TABLE statement; no INTO, FOR UPDATE, writes or several statements.",
      "The query sees exactly the rows and fields the signed-in user may read in Odoo (access rights, record rules, field groups, all of the user's companies); other rows are absent, not hidden behind an error.",
      "Write it against database table and column names. Find them in the generated `odoo` knowledge bundle or with odoo_describe_model, whose result gives the model's table when the server provides it: a table is not always the model name with dots replaced by underscores (res.partner is res_partner, but check). One-to-many fields are not columns; join the other table. A many-to-many table holds only pairs whose both records the user may read.",
      "Name the columns you need instead of SELECT *: only named columns are copied for the query, so it runs faster, and large tables may otherwise exceed the copy limit (result_too_large).",
      "Values come as JSON: numbers for numeric columns, ISO 8601 strings for dates and times, seconds for intervals, \\x… hexadecimal for bytea. limit is 1 to 1000 rows (default 100); truncated is true when there are more. tables lists the tables copied, with their model and the rows the user may read.",
      "A query_error carries PostgreSQL's sqlstate, position and message so you can fix the query: 0A000 means the statement is not allowed, 42601 a syntax error, 42P01 a table that is unknown, hidden or not readable (deliberately the same answer).",
      "Odoo runs only a few queries per user at once (often one): a query sent while others run waits up to about 12 seconds for its turn, then fails with too_many_requests, so send long queries one after another. unavailable means SQL is not set up on this server. Prefer odoo_search and odoo_group for simple lookups and totals.",
      SHARING,
    ].join(" "),
    inputSchema: objectSchema(
      {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 20000,
          description: "One SELECT, VALUES or TABLE statement, at most 20000 characters.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 1000,
          description: "Rows to return, 1 to 1000; default 100.",
        },
      },
      ["query"],
    ),
    outputSchema: {
      type: "object",
      properties: {
        columns: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, type: { type: "string" } },
            required: ["name", "type"],
          },
        },
        rows: { type: "array", items: { type: "array" } },
        truncated: { type: "boolean" },
        elapsedMs: { type: "integer" },
        tables: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              model: { type: ["string", "null"] },
              rows: { type: "integer" },
            },
            required: ["name", "model", "rows"],
          },
        },
      },
      required: ["columns", "rows", "truncated", "tables"],
    },
    params: (args) => ({ limit: 100, ...args }),
    result: objectResult,
  },
];

function objectResult(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function validateConfig(value = {}) {
  const diagnostics = [];
  const report = (code, field, message) => diagnostics.push({ code, field, message });
  const plain = value && typeof value === "object" && !Array.isArray(value);
  const input = plain ? value : {};
  if (!plain) report("invalid_config", "config", "Tool pack config must be an object.");
  for (const key of Object.keys(input)
    .filter((name) => !CONFIG_KEYS.has(name))
    .sort()) {
    report("unknown_config_key", key, `Unsupported Odoo tool pack config key: ${key}.`);
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
  const env = (key) => {
    const name = input[key];
    if (name === undefined) report(`missing_${snake(key)}`, key, `${key} is required.`);
    else if (typeof name !== "string" || !ENV_NAME.test(name)) {
      report(`invalid_${snake(key)}`, key, `${key} must be an environment-variable name.`);
    }
    return typeof name === "string" ? name : null;
  };
  const clientIdEnv = env("clientIdEnv");
  const clientSecretEnv = env("clientSecretEnv");
  if (clientIdEnv && clientIdEnv === clientSecretEnv) {
    report(
      "same_credential_env",
      "clientSecretEnv",
      "clientIdEnv and clientSecretEnv must differ.",
    );
  }
  const timeoutMs = input.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : input.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    report("invalid_timeout_ms", "timeoutMs", "timeoutMs must be an integer from 1000 to 120000.");
  }
  return {
    valid: diagnostics.length === 0,
    config: { url, clientIdEnv, clientSecretEnv, timeoutMs },
    diagnostics,
  };
}

function snake(key) {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// Runs one tool: arguments are checked against the schema before anything
// else, the call needs the signed-in user's token, and the credentials are
// read through getSecret for this call only.
async function runTool(tool, args, context = {}, dependencies = {}) {
  const input = args === undefined ? {} : args;
  const path = violation(tool.inputSchema, input);
  if (path !== null) throw new OdooToolError("invalid_arguments", { field: path });
  if (typeof context.subjectToken !== "string" || !context.subjectToken) {
    throw new OdooToolError("subject_token_required");
  }
  const validation = validateConfig(context.config);
  if (!validation.valid) throw new OdooToolError("invalid_config");
  const { config } = validation;
  if (typeof context.getSecret !== "function") {
    throw new OdooToolError("client_credentials_unavailable");
  }
  let clientId;
  let clientSecret;
  try {
    clientId = await context.getSecret(config.clientIdEnv);
    clientSecret = await context.getSecret(config.clientSecretEnv);
  } catch {
    throw new OdooToolError("client_credentials_unavailable");
  }
  const result = await callDataApi({
    url: config.url,
    op: tool.op,
    clientId,
    clientSecret,
    token: context.subjectToken,
    params: tool.params(input),
    signal: context.signal,
    timeoutMs: config.timeoutMs,
    maxResponseBytes: dependencies.maxResponseBytes,
    busyWaitMs: dependencies.busyWaitMs,
    fetch: dependencies.fetch,
  });
  const shaped = tool.result(result);
  if (!shaped) throw new OdooToolError("invalid_response");
  return shaped;
}

module.exports = { SCOPE, TOOLS, annotations, runTool, validateConfig };
