---
id: okf://okf-odoo/reference/configuration
type: OKF Reference
title: okf-odoo configuration
description: Producer configuration keys accepted by okf-odoo and their defaults.
tags: [okf, odoo, configuration]
relations:
  - type: configured_by
    target: repo://src/producer.js
  - type: checked_by
    target: repo://test/producer.test.js
---

# Configuration

The producer configuration lives under `producers[].config` in
`okf.project.yaml`. Unknown keys are rejected.

- `url` (required): base URL of the Odoo server without credentials, query or
  fragment; `https`, or `http` for a loopback host only.
- `api` (default `json2`): `json2` for Odoo 19 and 20, `jsonrpc` for Odoo 18.
- `database`: database name; the `X-Odoo-Database` header with `json2`,
  required and part of every call with `jsonrpc`.
- `login`: login of the API key's user; required with `jsonrpc`, refused with
  `json2`.
- `apiKeyEnv` (required): environment variable holding the API key; the host
  hands a producer only the variables its configuration names.
- `source` (default `odoo`): alias used in `odoo://` resource locators.
- `lang` (default `en_US`): language of labels and menu names.
- `sections` (default every section but `serverActions` and `mcpActions`):
  `modules`, `models`, `access`, `groups`, `menus`, `crons`, `reports`,
  `serverActions`, `mcpActions`. `access`, `crons`, `reports` and
  `serverActions` require `models`. `mcpActions` reads the actions the
  `o3p_mcp` addon exposes to MCP users and needs that addon on the server.
- `modules.include` and `modules.exclude`: module names, with `*` matching
  any characters, selecting the modules documented in full. A model is
  documented when a selected module defines or extends it.
- `otherModules` (default `summary`): `summary` renders the other installed
  modules without their models, `none` leaves them out.

The project must declare the relation types `defined_in`, `extended_by`,
`references`, `implies` and `opens`; `depends_on` is built into `okf-mcp`.
