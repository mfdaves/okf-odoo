# Changelog

All notable changes to `@mfdaves/okf-odoo`. The format follows Keep a Changelog; versions follow SemVer.

## 0.1.0 — unreleased

First release: a Producer API v1 producer that reads Odoo 19 and 20 metadata over the JSON-2 API and returns an OKF v0.2 bundle to a host such as `okf-mcp`.

### Added

- JSON-2 client limited to `fields_get`, `read` and `search_read` with explicit field lists, bearer API key, optional `X-Odoo-Database`, timeouts, paging by id, and fixed error codes (`invalid_api_key`, `access_denied`, `model_not_found`, `json2_unavailable`, `invalid_request`, `server_error`, `timeout`, `aborted`, `connection_failed`).
- Catalog reader for installed modules and dependencies, models, fields and selection values, access entries (`ir.access` on Odoo 20, `ir.model.access` and `ir.rule` on Odoo 19, one shape), groups, menus and window actions, scheduled jobs, reports and server actions, with one field allowlist per Odoo model.
- `sections` to select what is read; a section the key cannot read fails with `access_denied` and the section name.
- `modules.include` / `modules.exclude` and `otherModules: summary | none`.
- Renderer for `index.md`, `modules/`, `models/`, `groups/` and `apps/` concepts with the relation types `defined_in`, `extended_by`, `references`, `depends_on`, `implies` and `opens`; deterministic output so an unchanged database republishes nothing.
- Tests on responses recorded from Odoo 19 and 20, a mock smoke through okf-mcp's producer host, and live gates (`live:shape`, `live:smoke`) against a disposable Odoo in Docker.

### Known issues

- `okf-mcp` reports every producer exception as `producer_execution_failed`, so the `access_denied` code and section reach the user only when `generate()` is called directly.
