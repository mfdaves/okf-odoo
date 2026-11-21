---
id: okf://erp/models/crm.team
type: Odoo Model
title: crm.team
description: Odoo model crm.team (Sales Team) defined in sales_team.
resource: odoo://erp/crm.team
sources:
  - resource: odoo://erp/ir.model
    title: erp ir.model
  - resource: odoo://erp/ir.model.fields
    title: erp ir.model.fields
  - resource: odoo://erp/ir.model.access
    title: erp ir.model.access
  - resource: odoo://erp/ir.rule
    title: erp ir.rule
  - resource: odoo://erp/ir.cron
    title: erp ir.cron
  - resource: odoo://erp/ir.actions.report
    title: erp ir.actions.report
  - resource: odoo://erp/ir.actions.server
    title: erp ir.actions.server
generated:
  by: okf-odoo/0.2.0
  at: '2026-11-14T10:00:00.000Z'
tags:
  - odoo
  - model
  - sales_team
relations:
  - type: defined_in
    target: okf://erp/modules/sales_team
  - type: extended_by
    target: okf://erp/modules/sale
  - type: references
    target: okf://erp/models/crm.team.member
  - type: references
    target: okf://erp/models/res.users
---

# Sales Team (`crm.team`)

- Kind: model or abstract model (Odoo 18 does not record which)
- Defined in: [sales_team](../modules/sales_team.md)
- Extended by: [sale](../modules/sale.md)

## Fields

Field groups are not available on Odoo 18: it does not record which groups may access a field defined in code, so this table cannot show field-level restrictions.

"not searchable" and "not groupable" follow from how a field is stored; odoo_describe_model gives the exact flags for the signed-in user.

| Field | Label | Type | Relation | Properties | Modules | Help |
| --- | --- | --- | --- | --- | --- | --- |
| `active` | Active | `boolean` | — | stored | [sales_team](../modules/sales_team.md) | If the active field is set to false, it will allow you to hide the Sales Team without removing it. |
| `color` | Color Index | `integer` | — | stored | [sales_team](../modules/sales_team.md) | The color of the channel |
| `company_id` | Company | `many2one` | `res.company` | stored, indexed, on delete set null | [sales_team](../modules/sales_team.md) | — |
| `create_date` | Created on | `datetime` | — | read-only, stored | [sales_team](../modules/sales_team.md) | — |
| `create_uid` | Created by | `many2one` | [res.users](res.users.md) | read-only, stored, on delete set null | [sales_team](../modules/sales_team.md) | — |
| `crm_team_member_all_ids` | Sales Team Members (incl. inactive) | `one2many` | [crm.team.member](crm.team.member.md) (`crm_team_id`) | not stored (no column), not groupable | [sales_team](../modules/sales_team.md) | — |
| `crm_team_member_ids` | Sales Team Members | `one2many` | [crm.team.member](crm.team.member.md) (`crm_team_id`) | not stored (no column), not groupable | [sales_team](../modules/sales_team.md) | Add members to automatically assign their documents to this sales team. |
| `currency_id` | Currency | `many2one` | `res.currency` | read-only, not stored, related to `company_id.currency_id` | [sales_team](../modules/sales_team.md) | — |
| `dashboard_button_name` | Dashboard Button | `char` | — | read-only, not stored, not searchable, not groupable | [sales_team](../modules/sales_team.md) | — |
| `dashboard_graph_data` | Dashboard Graph Data | `text` | — | read-only, not stored, not searchable, not groupable | [sales_team](../modules/sales_team.md) | — |
| `display_name` | Display Name | `char` | — | read-only, not stored, not groupable | [sales_team](../modules/sales_team.md) | — |
| `favorite_user_ids` | Favorite Members | `many2many` | [res.users](res.users.md) | not stored (no column) | [sales_team](../modules/sales_team.md) | — |
| `has_message` | Has Message | `boolean` | — | read-only, not stored, not groupable | [sales_team](../modules/sales_team.md) | — |
| `id` | ID | `integer` | — | read-only, stored | [sales_team](../modules/sales_team.md) | — |
| `invoiced` | Invoiced This Month | `float` | — | read-only, not stored, not searchable, not groupable | [sale](../modules/sale.md) | Invoice revenue for the current month. This is the amount the sales channel has invoiced this month. It is used to compute the progression ratio of the current and target revenue on the kanban view. |
| `invoiced_target` | Invoicing Target | `float` | — | stored | [sale](../modules/sale.md) | Revenue Target for the current month (untaxed total of paid invoices). |
| `is_favorite` | Show on dashboard | `boolean` | — | not stored, not searchable, not groupable | [sales_team](../modules/sales_team.md) | Favorite teams to display them in the dashboard and access them easily. |
| `is_membership_multi` | Multiple Memberships Allowed | `boolean` | — | read-only, not stored, not searchable, not groupable | [sales_team](../modules/sales_team.md) | If True, users may belong to several sales teams. Otherwise membership is limited to a single sales team. |
| `member_company_ids` | Member Company | `many2many` | `res.company` | read-only, not stored (no column), not searchable | [sales_team](../modules/sales_team.md) | UX: Limit to team company or all if no company |
| `member_ids` | Salespersons | `many2many` | [res.users](res.users.md) | not stored (no column) | [sales_team](../modules/sales_team.md) | Users assigned to this team. |
| `member_warning` | Membership Issue Warning | `text` | — | read-only, not stored, not searchable, not groupable | [sales_team](../modules/sales_team.md) | — |
| `message_attachment_count` | Attachment Count | `integer` | — | read-only, not stored, not searchable, not groupable | [sales_team](../modules/sales_team.md) | — |
| `message_follower_ids` | Followers | `one2many` | `mail.followers` (`res_id`) | not stored (no column), not groupable | [sales_team](../modules/sales_team.md) | — |
| `message_has_error` | Message Delivery error | `boolean` | — | read-only, not stored, not groupable | [sales_team](../modules/sales_team.md) | If checked, some messages have a delivery error. |
| `message_has_error_counter` | Number of errors | `integer` | — | read-only, not stored, not searchable, not groupable | [sales_team](../modules/sales_team.md) | Number of messages with delivery error |
| `message_has_sms_error` | SMS Delivery error | `boolean` | — | read-only, not stored, not groupable | [sms](../modules/sms.md) | If checked, some messages have a delivery error. |
| `message_ids` | Messages | `one2many` | `mail.message` (`res_id`) | not stored (no column), not groupable | [sales_team](../modules/sales_team.md) | — |
| `message_is_follower` | Is Follower | `boolean` | — | read-only, not stored, not groupable | [sales_team](../modules/sales_team.md) | — |
| `message_needaction` | Action Needed | `boolean` | — | read-only, not stored, not groupable | [sales_team](../modules/sales_team.md) | If checked, new messages require your attention. |
| `message_needaction_counter` | Number of Actions | `integer` | — | read-only, not stored, not searchable, not groupable | [sales_team](../modules/sales_team.md) | Number of messages requiring action |
| `message_partner_ids` | Followers (Partners) | `many2many` | `res.partner` | not stored (no column) | [sales_team](../modules/sales_team.md) | — |
| `name` | Sales Team | `char` | — | required, stored, translated | [sales_team](../modules/sales_team.md) | — |
| `quotations_amount` | Amount of quotations to invoice | `float` | — | read-only, not stored, not searchable, not groupable | [sale](../modules/sale.md) | — |
| `quotations_count` | Number of quotations to invoice | `integer` | — | read-only, not stored, not searchable, not groupable | [sale](../modules/sale.md) | — |
| `sale_order_count` | \# Sale Orders | `integer` | — | read-only, not stored, not searchable, not groupable | [sale](../modules/sale.md) | — |
| `sales_to_invoice_count` | Number of sales to invoice | `integer` | — | read-only, not stored, not searchable, not groupable | [sale](../modules/sale.md) | — |
| `sequence` | Sequence | `integer` | — | stored | [sales_team](../modules/sales_team.md) | — |
| `user_id` | Team Leader | `many2one` | [res.users](res.users.md) | stored, on delete set null | [sales_team](../modules/sales_team.md) | — |
| `website_message_ids` | Website Messages | `one2many` | `mail.message` (`res_id`) | not stored (no column), not groupable | [portal](../modules/portal.md) | Website communication history |
| `write_date` | Last Updated on | `datetime` | — | read-only, stored | [sales_team](../modules/sales_team.md) | — |
| `write_uid` | Last Updated by | `many2one` | [res.users](res.users.md) | read-only, stored, on delete set null | [sales_team](../modules/sales_team.md) | — |

## Access

| Kind | Groups | Operations | Domain | Name |
| --- | --- | --- | --- | --- |
| permission | [User types / Internal User](../groups/base.group_user.md) | read | — | crm.team |
| permission | [Sales / Administrator](../groups/sales_team.group_sale_manager.md) | create, read, update, delete | — | crm.team.manager |
| permission | [Sales / User: Own Documents Only](../groups/sales_team.group_sale_salesman.md) | read | — | crm.team.user |
| restriction | everyone | create, read, update, delete | `[('company_id', 'in', company_ids + [False])]` | Sales Team multi-company |
| restriction | [Sales / User: All Documents](../groups/sales_team.group_sale_salesman_all_leads.md) | create, read, update, delete | `[(1,'=',1)]` | All Salesteam |

## Scheduled jobs

No scheduled jobs.

## Reports

No reports.

## Server actions

No server actions.
