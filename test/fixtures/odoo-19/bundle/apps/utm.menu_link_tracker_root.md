---
id: okf://erp/apps/utm.menu_link_tracker_root
type: Odoo Application
title: Link Tracker
description: Odoo top-level menu Link Tracker with 4 submenus.
resource: odoo://erp/ir.ui.menu/utm.menu_link_tracker_root
sources:
  - resource: odoo://erp/ir.ui.menu
    title: erp ir.ui.menu
  - resource: odoo://erp/ir.actions.act_window
    title: erp ir.actions.act_window
generated:
  by: okf-odoo/0.3.0-rc.1
  at: '2026-11-14T10:00:00.000Z'
tags:
  - odoo
  - application
  - menu
relations:
  - type: opens
    target: okf://erp/models/utm.campaign
  - type: opens
    target: okf://erp/models/utm.medium
  - type: opens
    target: okf://erp/models/utm.source
---

# Link Tracker

Top-level Odoo menu Link Tracker.

- XML id: `utm.menu_link_tracker_root`
- Visible to: [Technical Features](../groups/base.group_no_one.md)

## Menus

- UTMs — groups: [Technical Features](../groups/base.group_no_one.md)
  - Campaigns → [utm.campaign](../models/utm.campaign.md) — groups: [Technical Features](../groups/base.group_no_one.md)
  - Mediums → [utm.medium](../models/utm.medium.md) — groups: [Technical Features](../groups/base.group_no_one.md)
  - Sources → [utm.source](../models/utm.source.md) — groups: [Technical Features](../groups/base.group_no_one.md)
