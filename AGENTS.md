# Project Agent Rules

## Product Boundary

`okf-odoo` is a read-only Odoo metadata producer. It reads the technical
catalog of an Odoo database (modules, models, fields, access rules, groups,
menus, scheduled jobs, reports, server actions) of Odoo 18, 19 and 20 over
JSON-2 or, as configured, JSON-RPC, and returns Open Knowledge Format v0.2 candidate files to a producer host such as
`okf-mcp`. It never reads business records, `ir.config_parameter` values or
server-action code, and never calls a method that writes.

Keep the API key outside configuration and generated output. Accept an
environment-variable name, not an inline key, in persisted configuration or
examples.

## Implementation

- Keep the Odoo client (both protocols), catalog reading, Markdown escaping
  and OKF rendering separate. Field names that differ between Odoo versions
  live in `VERSIONS` in `src/catalog.js`, measured on a live server.
- Publication belongs to the host: there is no standalone writer or CLI.
- Output must be deterministic: stable ordering and paths, no volatile values
  other than `generated.at`, so an unchanged database reports `unchanged`.
- Every field read from Odoo is named in an allowlist in `src/catalog.js`.
- Keep the runtime small: `js-yaml` and built-in `fetch` only.

## Validation

Run `npm test`, `npm run lint`, `npm run format:check`, `npm run smoke`, and
`npm run pack:check`. The normal test suite uses recorded fixtures and a fake
JSON-2 server and must not require a live Odoo. The live gates
(`npm run live:shape`, `npm run live:smoke`) run against the disposable server
of `scripts/live-odoo.sh`; report them separately. Re-record fixtures with
`npm run live:record` and refresh snapshots with `UPDATE_SNAPSHOTS=1 npm test`
only when a change to the reader or renderer is intended.
