---
id: okf://erp/modules/sales_team
type: Odoo Module
title: Sales Teams (sales_team)
description: Sales Teams
resource: odoo://erp/ir.module.module/sales_team
sources:
  - resource: odoo://erp/ir.module.module
    title: erp ir.module.module
  - resource: odoo://erp/ir.module.module.dependency
    title: erp ir.module.module.dependency
generated:
  by: okf-odoo/0.3.0-rc.1
  at: '2026-11-14T10:00:00.000Z'
tags:
  - odoo
  - module
relations:
  - type: depends_on
    target: okf://erp/modules/base
  - type: depends_on
    target: okf://erp/modules/mail
---

# Sales Teams

Sales Teams

- Technical name: `sales_team`
- Installed version: `20.0.1.1`
- Category: Sales
- Application: no
- Installed automatically with its dependencies: no
- License: LGPL-3
- Documented in full: yes

## Dependencies

- [base](base.md)
- [mail](mail.md)

## Models defined

- [crm.tag](../models/crm.tag.md) — CRM Tag
- [crm.team](../models/crm.team.md) — Sales Team
- [crm.team.member](../models/crm.team.member.md) — Sales Team Member

## Models extended

- [res.users](../models/res.users.md) — User
