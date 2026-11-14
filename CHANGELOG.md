# Changelog

All notable changes to `@mfdaves/okf-odoo`. The format follows Keep a Changelog; versions follow SemVer.

## 0.1.0 — unreleased

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
- `odoo_search`, `odoo_read`, `odoo_group` and `odoo_sql` remind the agent that results follow the signed-in user's Odoo access while knowledge written from them is readable by every MCP user, so it should record conclusions and aggregates rather than personal or confidential values.
- Domains in the tool pack no longer accept `child_of` and `parent_of`, which the data API refuses; descriptions say that text conditions on a relation match the related record's display name and that models hiding part of a record may refuse filters on non-public fields.
- `odoo_sql` (scope `odoo.sql`): one read-only SQL statement through the data API's `sql` operation, limit 1–1000 (default 100), with an output schema for columns, rows, truncation, elapsed time and copied tables; `query_error` passes PostgreSQL's `sqlstate`, `position` and `message` (at most 500 characters) on in `details`; new codes `too_many_requests` and `unavailable`. `odoo_describe_model` documents the model's `table` when the server returns it.
- Tool pack tools declare `requiresSubjectToken: true`; argument errors carry the offending parameter in `details` (`field`, `path`); the default per-call timeout is 25 s, below okf-mcp's 30 s.
- The tool pack's schemas follow the data API's limits: aggregates `sum`, `avg`, `min`, `max`, `count`, `count_distinct` and `__count` only, field paths of at most 4 fields, plain field names in search orders; descriptions state the group value formats and that `odoo_read` silently leaves out missing or unreadable ids.

### Known issues

- Odoo 18 and 19 do not record the groups of fields defined in code (`ir.model.fields.groups` stays empty), so on those versions model concepts state that field groups are not available.
- Odoo 18 does not record which models are abstract; their kind reads "model or abstract model".
- The tool pack targets okf-mcp's tool-pack API v1, which is experimental; its shape may still change.
- `okf-mcp` reports every producer exception as `producer_execution_failed`, so the `access_denied` code and section reach the user only when `generate()` is called directly.
