---
id: okf://okf-odoo/reference/access-rights
type: OKF Reference
title: okf-odoo access rights per section
description: The Odoo group a key's user needs to read each okf-odoo section, measured on Odoo 18, 19 and 20.
tags: [okf, odoo, security]
relations:
  - type: configured_by
    target: repo://src/catalog.js
  - type: checked_by
    target: repo://scripts/live-smoke.js
---

# Access rights per section

Measured on Odoo 18, 19 and 20 with `base` and `sale` installed. Group names
are resolved through `res.groups` and `ir.model.data`, so every section that
shows groups needs Access Rights at least.

- Internal user: `modules` (`ir.module.module`,
  `ir.module.module.dependency`); on Odoo 18 the dependencies need Settings.
  Every run also reads the version of `base`, which any internal user can.
- Administration: Access Rights: `models` (`ir.model`, `ir.model.data`,
  `ir.model.fields`, `ir.model.fields.selection`), `access` (`ir.access`, or
  `ir.model.access` and `ir.rule` on Odoo 18 and 19), `groups` (`res.groups`) and
  `reports` (`ir.actions.report`).
- Administration: Settings: `menus` (`ir.actions.act_window`), `crons`
  (`ir.cron`) and `serverActions` (`ir.actions.server`).

The default sections include `menus` and `crons`, so the full catalog needs a
Settings administrator's key; a dedicated technical user is recommended. A
section the key cannot read fails the run with `access_denied` naming the
section instead of publishing less.
