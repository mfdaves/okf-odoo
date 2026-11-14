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
  - resource: odoo://erp/ir.access
    title: erp ir.access
  - resource: odoo://erp/ir.cron
    title: erp ir.cron
  - resource: odoo://erp/ir.actions.report
    title: erp ir.actions.report
  - resource: odoo://erp/ir.actions.server
    title: erp ir.actions.server
generated:
  by: okf-odoo/0.1.0
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

- Kind: model
- Defined in: [sales_team](../modules/sales_team.md)
- Extended by: [sale](../modules/sale.md)

## Fields

Field | Label | Type | Relation | Properties | Modules | Help
--- | --- | --- | --- | --- | --- | ---
<code>active</code> | Active | <code>boolean</code> | — | stored | [sales_team](../modules/sales_team.md) | If the active field is set to false, it will allow you to hide the Sales Team without removing it.
<code>color</code> | Color Index | <code>integer</code> | — | stored | [sales_team](../modules/sales_team.md) | The color of the channel
<code>company_id</code> | Company | <code>many2one</code> | <code>res.company</code> | stored, indexed (btree), on delete set null | [sales_team](../modules/sales_team.md) | —
<code>create_date</code> | Created on | <code>datetime</code> | — | read-only, stored | [sales_team](../modules/sales_team.md) | —
<code>create_uid</code> | Created by | <code>many2one</code> | [res.users](res.users.md) | read-only, stored, on delete set null | [sales_team](../modules/sales_team.md) | —
<code>crm_team_member_all_ids</code> | Sales Team Members (incl. inactive) | <code>one2many</code> | [crm.team.member](crm.team.member.md) (<code>crm_team_id</code>) | stored | [sales_team](../modules/sales_team.md) | —
<code>crm_team_member_ids</code> | Sales Team Members | <code>one2many</code> | [crm.team.member](crm.team.member.md) (<code>crm_team_id</code>) | stored | [sales_team](../modules/sales_team.md) | Add members to automatically assign their documents to this sales team.
<code>currency_id</code> | Currency | <code>many2one</code> | <code>res.currency</code> | read-only, not stored, related to <code>company_id.currency_id</code> | [sales_team](../modules/sales_team.md) | —
<code>dashboard_button_name</code> | Dashboard Button | <code>char</code> | — | read-only, not stored | [sales_team](../modules/sales_team.md) | —
<code>display_name</code> | Display Name | <code>char</code> | — | read-only, not stored | [sale](../modules/sale.md), [sales_team](../modules/sales_team.md) | —
<code>favorite_user_ids</code> | Favorite Members | <code>many2many</code> | [res.users](res.users.md) | stored | [sales_team](../modules/sales_team.md) | —
<code>has_message</code> | Has Message | <code>boolean</code> | — | read-only, not stored | [sales_team](../modules/sales_team.md) | —
<code>id</code> | ID | <code>integer</code> | — | read-only, stored | [sale](../modules/sale.md), [sales_team](../modules/sales_team.md) | —
<code>is_favorite</code> | Show on dashboard | <code>boolean</code> | — | not stored | [sales_team](../modules/sales_team.md) | Favorite teams to display them in the dashboard and access them easily.
<code>is_membership_multi</code> | Multiple Memberships Allowed | <code>boolean</code> | — | read-only, not stored | [sales_team](../modules/sales_team.md) | If True, users may belong to several sales teams. Otherwise membership is limited to a single sales team.
<code>member_company_ids</code> | Member Company | <code>many2many</code> | <code>res.company</code> | read-only, not stored | [sales_team](../modules/sales_team.md) | UX: Limit to team company or all if no company
<code>member_ids</code> | Salespersons | <code>many2many</code> | [res.users](res.users.md) | not stored | [sales_team](../modules/sales_team.md) | Users assigned to this team.
<code>member_warning</code> | Membership Issue Warning | <code>text</code> | — | read-only, not stored | [sales_team](../modules/sales_team.md) | —
<code>message_attachment_count</code> | Attachment Count | <code>integer</code> | — | read-only, not stored, groups: [Role / User](../groups/base.group_user.md) | [sales_team](../modules/sales_team.md) | —
<code>message_follower_ids</code> | Followers | <code>one2many</code> | <code>mail.followers</code> (<code>res_id</code>) | stored, groups: [Role / User](../groups/base.group_user.md) | [sales_team](../modules/sales_team.md) | —
<code>message_has_error</code> | Message Delivery error | <code>boolean</code> | — | read-only, not stored | [sales_team](../modules/sales_team.md) | If checked, some messages have a delivery error.
<code>message_has_error_counter</code> | Number of errors | <code>integer</code> | — | read-only, not stored | [sales_team](../modules/sales_team.md) | Number of messages with delivery error
<code>message_has_sms_error</code> | SMS Delivery error | <code>boolean</code> | — | read-only, not stored | [sms](../modules/sms.md) | If checked, some messages have a delivery error.
<code>message_ids</code> | Messages | <code>one2many</code> | <code>mail.message</code> (<code>res_id</code>) | stored | [sales_team](../modules/sales_team.md) | —
<code>message_is_follower</code> | Is Follower | <code>boolean</code> | — | read-only, not stored | [sales_team](../modules/sales_team.md) | —
<code>message_needaction</code> | Action Needed | <code>boolean</code> | — | read-only, not stored | [sales_team](../modules/sales_team.md) | If checked, new messages require your attention.
<code>message_needaction_counter</code> | Number of Actions | <code>integer</code> | — | read-only, not stored | [sales_team](../modules/sales_team.md) | Number of messages requiring action
<code>message_partner_ids</code> | Followers (Partners) | <code>many2many</code> | <code>res.partner</code> | not stored | [sales_team](../modules/sales_team.md) | —
<code>name</code> | Sales Team | <code>char</code> | — | required, stored, translated (standard) | [sales_team](../modules/sales_team.md) | —
<code>sale_order_count</code> | # Sale Orders | <code>integer</code> | — | read-only, not stored | [sale](../modules/sale.md) | —
<code>sequence</code> | Sequence | <code>integer</code> | — | stored | [sales_team](../modules/sales_team.md) | —
<code>user_id</code> | Team Leader | <code>many2one</code> | [res.users](res.users.md) | stored, on delete set null | [sales_team](../modules/sales_team.md) | —
<code>write_date</code> | Last Updated on | <code>datetime</code> | — | read-only, stored | [sales_team](../modules/sales_team.md) | —
<code>write_uid</code> | Last Updated by | <code>many2one</code> | [res.users](res.users.md) | read-only, stored, on delete set null | [sales_team](../modules/sales_team.md) | —

## Access

Kind | Groups | Operations | Domain | Name
--- | --- | --- | --- | ---
permission | [Role / User](../groups/base.group_user.md) | read | — | crm.team
permission | [Sales / Administrator](../groups/sales_team.group_sale_manager.md) | create, read, update, delete | — | All Salesteam
restriction | everyone | create, read, update, delete | <code>[('company_id', 'in', company_ids + [False])]</code> | Sales Team multi-company

## Scheduled jobs

No scheduled jobs.

## Reports

No reports.

## Server actions

No server actions.
