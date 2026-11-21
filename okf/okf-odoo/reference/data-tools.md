---
id: okf://okf-odoo/reference/data-tools
type: OKF Reference
title: okf-odoo data tools
description: The Odoo data tools okf-odoo offers to an MCP host as an experimental tool pack - reading, SQL, writing records and running exposed actions.
tags: [okf, odoo, mcp, tools]
relations:
  - type: configured_by
    target: repo://src/tool-pack.js
  - type: configured_by
    target: repo://src/tools.js
  - type: configured_by
    target: repo://src/data-api.js
  - type: checked_by
    target: repo://test/tool-pack.test.js
---

# Odoo data tools

`okfToolPack` (tool-pack API version 1, id `odoo`) offers `odoo_find_models`,
`odoo_describe_model`, `odoo_search`, `odoo_read` and `odoo_group`, each with
the scope `odoo.read`, and `odoo_sql` with the scope `odoo.sql`: one
read-only statement over only the rows and fields the user may read, whose
`query_error` carries PostgreSQL's `sqlstate`, `position` and `message`.

`odoo_create`, `odoo_update` and `odoo_run_action` need the scope
`odoo.write` and are announced as not read-only. The first two write field
values on the models the Odoo administrator opened. `odoo_run_action` runs
an action the administrator exposed in Odoo, by its name: a record button, a
server action, or a wizard that is filled with the given values and whose
buttons are pressed in one call. `odoo_find_actions` and
`odoo_describe_action` (scope `odoo.read`) list the actions a user may run
and what each asks for. When Odoo itself refuses a change or an action, the
`query_error` carries Odoo's message for the user in `details.message`.

Each tool posts to `{url}/o3p_mcp/api/v1/{op}` of the `o3p_mcp` Odoo addon
with the MCP server's resource-server credentials as HTTP Basic and the
signed-in user's access token as the subject. The addon runs the operation as
that user, so results contain only what the user may read. Without a subject
token, which exists only over HTTP, a tool fails with
`subject_token_required`.

Configuration: `url` (https, or http for a loopback host), `clientIdEnv` and
`clientSecretEnv` (environment-variable names), optional `timeoutMs` (25 s
by default, which must stay below the host's own per-call limit).
Arguments are checked against strict input schemas before a request; errors
are bounded codes with fixed messages, and neither Odoo's text nor the token
or credentials reach a result or an error.
