# Changelog

All notable changes to `@mfdaves/okf-odoo`. The format follows Keep a Changelog; versions follow SemVer.

## Unreleased

### Added

- Tools `odoo_create` and `odoo_update` (data API operations `create` and `update`, scope `odoo.write`, `o3p_mcp` 1.43 or newer): create up to 20 records, or set fields of up to 100 records given by id, as the signed-in user, on the models the Odoo administrator opened for writing. They are announced with `readOnlyHint: false`; a refusal by Odoo itself carries Odoo's message in `details.message`.
- Tool `odoo_context` (data API operation `context`, `o3p_mcp` 1.42 or newer): the signed-in user, the language and time zone of the answers, the user's default company and all the user's companies, the current time in UTC and today's date in the user's time zone.

### Changed

- `odoo_group`: `groupby` is optional; without it the answer is one group holding the totals over all matching records (`o3p_mcp` 1.42 or newer). Its description says that a date bucket is a period in the user's time zone whose start is given in UTC.

## 0.1.2 — 2026-11-15

No runtime change.

### Changed

- The Release workflow publishes each version with `npm publish` through the trusted publisher, with npm provenance. 0.1.2 is the first version released this way and the first with npm provenance (0.1.0 was published by hand). 0.1.1 was staged with `npm stage publish` and never published.

## 0.1.0 — 2026-11-15

First release: a Producer API v1 producer that reads Odoo 18, 19 and 20 metadata over the JSON-2 API or JSON-RPC and returns an OKF v0.2 bundle to a host such as `okf-mcp`.

### Added

- JSON-2 client limited to `fields_get`, `read` and `search_read` with explicit field lists, bearer API key over `https` (plain `http` only for a loopback host), optional `X-Odoo-Database`, timeouts, paging by id, a 32 MiB response limit enforced while the body streams, and fixed error codes (`invalid_api_key`, `access_denied`, `model_not_found`, `json2_unavailable`, `invalid_request`, `server_error`, `timeout`, `aborted`, `connection_failed`).
- JSON-RPC client for Odoo 18 (`api: jsonrpc`): `execute_kw` on `/jsonrpc` with the database, the user id resolved once through `authenticate` with the new `login` key, and the API key as password; the same allowlist, refusals, http rule, size limit and abort handling as JSON-2, with errors mapped by exception name only (`jsonrpc_unavailable` when the endpoint is missing). A redirect to the login page reads as a missing endpoint.
- Version detection from the installed version of `base`, with one field allowlist per supported version (18, 19, 20) and `unsupported_odoo_version` otherwise.
- Catalog reader for installed modules and dependencies, models, fields and selection values, access entries (`ir.access` on Odoo 20, `ir.model.access` and `ir.rule` on Odoo 18 and 19, one shape), groups, menus and window actions, scheduled jobs, reports and server actions, with one field allowlist per Odoo model.
- Producer configuration with a required `apiKeyEnv`, because the host hands a producer only the secrets its configuration names.
- `sections` to select what is read; a section the key cannot read fails with `access_denied` and the section name.
- `modules.include` / `modules.exclude` and `otherModules: summary | none`.
- One escaping module for every string read from Odoo, with explicit contexts (inline text, line-start text, code span with a delimiter longer than any backtick run, table cell, link text), checked against a hostile corpus with okf-mcp's parser.
- Renderer for `index.md`, `modules/`, `models/`, `groups/` and `apps/` concepts with the relation types `defined_in`, `extended_by`, `references`, `depends_on`, `implies` and `opens`; deterministic output so an unchanged database republishes nothing, and file names that stay distinct on case-insensitive file systems and never take the reserved `index.md` or `log.md`.
- Tests on responses recorded from Odoo 18, 19 and 20, a mock smoke through okf-mcp's producer host, and live gates (`live:shape`, `live:smoke`) against a disposable Odoo in Docker.
- Experimental tool pack `okfToolPack` (okf-mcp tool-pack API v1) with `odoo_find_models`, `odoo_describe_model`, `odoo_search`, `odoo_read` and `odoo_group`: read-only calls to the `o3p_mcp` data API in Odoo as the resource server, with the signed-in user's token as the subject, strict input schemas, bounded error codes and the same transport hardening as the producer client.
- Model concepts render one2many and many2many fields as "not stored (no column)" instead of "stored", and mark fields "not searchable" (neither stored nor searchable through a method, read from `ir.model.fields.selectable`) or "not groupable" where the metadata shows it; fixtures re-recorded on Odoo 18, 19 and 20 for the new field.
- Tool errors forward the data API's `details` (`field`, `reason`, `hint`, single-line, at most 200 characters) for every operation; `odoo_find_models` takes `offset` and reports `total` and `truncated`; `odoo_describe_model`'s output schema lists `stored`, `searchable`, `sortable` and `groupable`, and the descriptions tell the agent to filter, sort and group only on fields marked so and to look for a public counterpart when a model is denied.
- `odoo_search`, `odoo_read`, `odoo_group` and `odoo_sql` remind the agent that results follow the signed-in user's Odoo access while knowledge written from them is readable by every MCP user, so it should record conclusions and aggregates rather than personal or confidential values.
- Domains in the tool pack no longer accept `child_of` and `parent_of`, which the data API refuses; descriptions say that text conditions on a relation match the related record's display name and that models hiding part of a record may refuse filters on non-public fields.
- `odoo_sql` (scope `odoo.sql`): one read-only SQL statement through the data API's `sql` operation, limit 1–1000 (default 100), with an output schema for columns, rows, truncation, elapsed time and copied tables; `query_error` passes PostgreSQL's `sqlstate`, `position` and `message` (at most 500 characters) on in `details`; new codes `too_many_requests` and `unavailable`. `odoo_describe_model` documents the model's `table` when the server returns it.
- Tool pack tools declare `requiresSubjectToken: true`; argument errors carry the offending parameter in `details` (`field`, `path`); the default per-call timeout is 25 s, below okf-mcp's 30 s.
- The tool pack's schemas follow the data API's limits: aggregates `sum`, `avg`, `min`, `max`, `count`, `count_distinct` and `__count` only, field paths of at most 4 fields, plain field names in search orders; descriptions state the group value formats and that `odoo_read` silently leaves out missing or unreadable ids.
- A call the data API refuses with `too_many_requests` (the user's SQL slots or the sandbox's connections all taken) waits and is sent again, after 250 ms, 500 ms, then every second, for up to 12 s and never past the point that leaves the last attempt 5 s of the call's `timeoutMs`; the wait happens in the host and holds no Odoo worker. A refusal that outlasts it carries a hint to send the queries one after another, and `odoo_sql`'s description says so.

### Known issues

- Odoo 18 and 19 do not record the groups of fields defined in code (`ir.model.fields.groups` stays empty), so on those versions model concepts state that field groups are not available.
- Odoo 18 does not record which models are abstract; their kind reads "model or abstract model".
- The tool pack targets okf-mcp's tool-pack API v1, which is experimental; its shape may still change.
- `okf-mcp` reports every producer exception as `producer_execution_failed`, so the `access_denied` code and section reach the user only when `generate()` is called directly.
