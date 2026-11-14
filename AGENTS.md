# Project Agent Rules

## Product Boundary

`okf-odoo` is a read-only Odoo metadata producer. It reads the technical
catalog of an Odoo database (modules, models, fields, access rules, groups,
menus, scheduled jobs, reports, server actions) over Odoo's JSON-2 API and
returns Open Knowledge Format v0.2 candidate files to a producer host such as
`okf-mcp`. It never reads business records, `ir.config_parameter` values or
server-action code, and never calls a method that writes.

Keep the API key outside configuration and generated output. Accept an
environment-variable name, not an inline key, in persisted configuration or
examples.

## Implementation

- Keep the JSON-2 client, catalog reading, and OKF rendering separate.
- Publication belongs to the host: there is no standalone writer or CLI.
- Output must be deterministic: stable ordering and paths, no volatile values
  other than `generated.at`, so an unchanged database reports `unchanged`.
- Every field read from Odoo is named in an allowlist in `src/catalog.js`.
- Keep the runtime small: `js-yaml` and built-in `fetch` only.

## Validation

Run `npm test`, `npm run lint`, `npm run format:check`, `npm run smoke`, and
`npm run pack:check`. The normal test suite uses recorded fixtures and a fake
JSON-2 server and must not require a live Odoo. When a live Odoo is used for
additional verification, report it separately.
