---
id: okf://okf-odoo/overview/okf-odoo
type: OKF Product
title: okf-odoo
description: Read-only Odoo metadata producer for deterministic Open Knowledge Format bundles.
tags: [okf, odoo, producer, metadata]
relations:
  - type: configured_by
    target: repo://src/odoo.js
  - type: configured_by
    target: repo://src/catalog.js
  - type: configured_by
    target: repo://src/render.js
  - type: configured_by
    target: repo://src/producer.js
  - type: checked_by
    target: repo://test/catalog.test.js
  - type: checked_by
    target: repo://test/render.test.js
  - type: checked_by
    target: repo://test/live-shape.test.js
  - type: related_to
    target: okf://okf-odoo/reference/configuration
  - type: related_to
    target: okf://okf-odoo/reference/access-rights
  - type: related_to
    target: okf://okf-odoo/reference/output
---

# okf-odoo

`okf-odoo` reads the technical catalog of an Odoo 19 or 20 database over the
JSON-2 API: installed modules, models, fields and selection values, access
rights and record rules, groups, menus and the models they open, scheduled
jobs, reports and, on request, server actions. It never reads business
records, system parameter values or server-action code, and only calls
`fields_get`, `read` and `search_read` with an explicit field list.

The package is a Producer API v1 producer without a command line. A host such
as `okf-mcp` loads it by its package name, hands it the API key from an
environment variable, validates the candidate files and publishes them. The
JSON-2 client, the catalog reader, the renderer and the producer descriptor
are separate modules.

Version differences are handled in the catalog reader: Odoo 20 merges access
rights and record rules into `ir.access`, and stores the index kind of a field
where Odoo 19 stores a boolean. The rendered output is a pure function of the
catalog, so an unchanged database republishes no file.
