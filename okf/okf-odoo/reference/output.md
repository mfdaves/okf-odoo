---
id: okf://okf-odoo/reference/output
type: OKF Reference
title: okf-odoo generated bundle
description: Concept paths, relation types and provenance of the bundle okf-odoo generates.
tags: [okf, odoo, output]
relations:
  - type: configured_by
    target: repo://src/render.js
  - type: checked_by
    target: repo://test/render.test.js
---

# Generated bundle

- `index.md` links every generated concept.
- `modules/<name>.md`: version, category, dependencies, models defined and
  extended.
- `models/<model>.md`: fields and selection values, and when selected the
  access entries, scheduled jobs, reports and server actions of the model.
- `groups/<xmlid>.md`: implied groups, the groups implying it and its access
  on documented models.
- `apps/<xmlid>.md`: a top-level menu, its submenus and the models their
  window actions open.
- `actions/<name>.md`, with the section `mcpActions`: an action the `o3p_mcp`
  addon exposes to MCP users, with what it does and runs, the records and
  values it takes and the groups it is limited to. The concepts of its model
  and of its wizard list it under "Exposed actions".

Relation types: `defined_in` (model to the module that registered it first),
`extended_by` (model to the other modules), `references` (model to the models
its relational fields target, and exposed action to its model and wizard), `depends_on` (module to module), `implies`
(group to group) and `opens` (application to model). Relations and links are
emitted only when the target is generated.

Each concept carries `generated.by`, `generated.at`, a `resource` such as
`odoo://<source>/sale.order` and `sources` naming the Odoo models read. Paths
and ordering are stable and `generated.at` is the only time value, so an
unchanged database republishes no file.
