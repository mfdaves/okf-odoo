---
id: okf://erp/groups/sales_team.group_sale_manager
type: Odoo Group
title: Sales / Administrator
description: the user will have an access to the sales configuration as well as statistic reports.
resource: odoo://erp/res.groups/sales_team.group_sale_manager
sources:
  - resource: odoo://erp/res.groups
    title: erp res.groups
  - resource: odoo://erp/ir.model.data
    title: erp ir.model.data
generated:
  by: okf-odoo/0.1.2
  at: '2026-11-14T10:00:00.000Z'
tags:
  - odoo
  - group
relations:
  - type: implies
    target: okf://erp/groups/mail.group_mail_canned_response_admin
  - type: implies
    target: okf://erp/groups/sales_team.group_sale_salesman_all_leads
---

# Sales / Administrator

the user will have an access to the sales configuration as well as statistic reports.

- XML id: `sales_team.group_sale_manager`
- Application: Sales
- Portal or public group: no

## Implies

- [Canned Responses / Canned Response Administrator](mail.group_mail_canned_response_admin.md)
- [Sales / User: All Documents](sales_team.group_sale_salesman_all_leads.md)

## Implied by

No group implies this one.

## Access on documented models

| Model | Kind | Operations | Domain |
| --- | --- | --- | --- |
| [crm.tag](../models/crm.tag.md) | permission | create, read, update, delete | — |
| [crm.team](../models/crm.team.md) | permission | create, read, update, delete | — |
| [crm.team.member](../models/crm.team.member.md) | permission | create, read, update, delete | — |
