---
okf_version: '0.2'
---

# erp Odoo catalog

## Applications

- [Discuss](apps/mail.menu_root_discuss.md)
- [Dashboards](apps/spreadsheet_dashboard.spreadsheet_dashboard_menu_root.md)
- [Invoicing](apps/account.menu_finance.md)
- [Link Tracker](apps/utm.menu_link_tracker_root.md)
- [Apps](apps/base.menu_management.md)
- [Settings](apps/base.menu_administration.md)
- [Tests](apps/base.menu_tests.md)

## Modules

- [account](modules/account.md) — Invoicing
- [account_add_gln](modules/account_add_gln.md) — Add Partner GLN
- [account_edi_ubl_cii](modules/account_edi_ubl_cii.md) — Import/Export electronic invoices with UBL/CII
- [account_payment](modules/account_payment.md) — Payment - Account
- [analytic](modules/analytic.md) — Analytic Accounting
- [api_doc](modules/api_doc.md) — API Documentation
- [auth_passkey](modules/auth_passkey.md) — Passkeys
- [auth_passkey_portal](modules/auth_passkey_portal.md) — Passkeys Portal
- [auth_signup](modules/auth_signup.md) — Signup
- [auth_totp](modules/auth_totp.md) — Two-Factor Authentication (TOTP)
- [auth_totp_mail](modules/auth_totp_mail.md) — 2FA Invite mail
- [auth_totp_portal](modules/auth_totp_portal.md) — TOTPortal
- [base](modules/base.md) — Base
- [base_import](modules/base_import.md) — Base import
- [base_import_module](modules/base_import_module.md) — Base import module
- [base_install_request](modules/base_install_request.md) — Base - Module Install Request
- [base_setup](modules/base_setup.md) — Initial Setup Tools
- [bus](modules/bus.md) — IM Bus
- [digest](modules/digest.md) — KPI Digests
- [google_gmail](modules/google_gmail.md) — Google Gmail
- [html_editor](modules/html_editor.md) — HTML Editor
- [http_routing](modules/http_routing.md) — Web Routing
- [iap](modules/iap.md) — In-App Purchases
- [iap_mail](modules/iap_mail.md) — IAP / Mail
- [mail](modules/mail.md) — Discuss
- [mail_bot](modules/mail_bot.md) — OdooBot
- [microsoft_outlook](modules/microsoft_outlook.md) — Microsoft Outlook
- [onboarding](modules/onboarding.md) — Onboarding Toolbox
- [partner_autocomplete](modules/partner_autocomplete.md) — Partner Autocomplete
- [payment](modules/payment.md) — Payment Engine
- [phone_validation](modules/phone_validation.md) — Phone Numbers Validation
- [portal](modules/portal.md) — Customer Portal
- [privacy_lookup](modules/privacy_lookup.md) — Privacy
- [product](modules/product.md) — Products & Pricelists
- [resource](modules/resource.md) — Resource
- [resource_mail](modules/resource_mail.md) — Resource Mail
- [rpc](modules/rpc.md) — RPC endpoints
- [sale](modules/sale.md) — Sales
- [sale_edi_ubl](modules/sale_edi_ubl.md) — Import electronic orders with UBL
- [sale_sms](modules/sale_sms.md) — Sale - SMS
- [sales_team](modules/sales_team.md) — Sales Teams
- [sms](modules/sms.md) — SMS gateway
- [snailmail](modules/snailmail.md) — Snail Mail
- [snailmail_account](modules/snailmail_account.md) — Snail Mail - Account
- [spreadsheet](modules/spreadsheet.md) — Spreadsheet
- [spreadsheet_account](modules/spreadsheet_account.md) — Spreadsheet Accounting Formulas
- [spreadsheet_dashboard](modules/spreadsheet_dashboard.md) — Spreadsheet dashboard
- [spreadsheet_dashboard_account](modules/spreadsheet_dashboard_account.md) — Spreadsheet dashboard for accounting
- [spreadsheet_dashboard_sale](modules/spreadsheet_dashboard_sale.md) — Spreadsheet dashboard for sales
- [uom](modules/uom.md) — Units of measure
- [utm](modules/utm.md) — UTM Trackers
- [web](modules/web.md) — Web
- [web_tour](modules/web_tour.md) — Tours
- [web_unsplash](modules/web_unsplash.md) — Unsplash Image Library

## Models

- [crm.tag](models/crm.tag.md) — CRM Tag
- [crm.team](models/crm.team.md) — Sales Team
- [crm.team.member](models/crm.team.member.md) — Sales Team Member
- [ir.http](models/ir.http.md) — HTTP Routing
- [res.users](models/res.users.md) — User
- [utm.campaign](models/utm.campaign.md) — UTM Campaign
- [utm.medium](models/utm.medium.md) — UTM Medium
- [utm.mixin](models/utm.mixin.md) — UTM Mixin
- [utm.source](models/utm.source.md) — UTM Source
- [utm.source.mixin](models/utm.source.mixin.md) — UTM Source Mixin
- [utm.stage](models/utm.stage.md) — Campaign Stage
- [utm.tag](models/utm.tag.md) — UTM Tag

## Groups

- [Basic](groups/account.group_account_basic.md)
- [Accounting / Invoicing](groups/account.group_account_invoice.md)
- [Accounting / Administrator](groups/account.group_account_manager.md)
- [Show Accounting Features - Readonly](groups/account.group_account_readonly.md)
- [Show Inalterability Features](groups/account.group_account_secured.md)
- [Show Full Accounting Features](groups/account.group_account_user.md)
- [Allow the cash rounding management](groups/account.group_cash_rounding.md)
- [Delivery Address](groups/account.group_delivery_invoice_address.md)
- [Partial Purchase Deductibility](groups/account.group_partial_purchase_deductibility.md)
- [Bank / Validate bank account](groups/account.group_validate_bank_account.md)
- [Analytic Accounting](groups/analytic.group_analytic_accounting.md)
- [Technical Documentation](groups/api_doc.group_allow_doc.md)
- [Default access for new users](groups/base.default_user_group.md)
- [Export / Allowed](groups/base.group_allow_export.md)
- [Access Rights](groups/base.group_erp_manager.md)
- [Multi Companies](groups/base.group_multi_company.md)
- [Multi Currencies](groups/base.group_multi_currency.md)
- [Technical Features](groups/base.group_no_one.md)
- [Contact / Creation](groups/base.group_partner_manager.md)
- [Role / Portal](groups/base.group_portal.md)
- [Role / Public](groups/base.group_public.md)
- [Bypass HTML Field Sanitize](groups/base.group_sanitize_override.md)
- [Role / Administrator](groups/base.group_system.md)
- [Role / User](groups/base.group_user.md)
- [Canned Responses / Canned Response Administrator](groups/mail.group_mail_canned_response_admin.md)
- [Receive notifications in Odoo](groups/mail.group_mail_notification_type_inbox.md)
- [Mail Template Editor](groups/mail.group_mail_template_editor.md)
- [Products / Create](groups/product.group_product_manager.md)
- [Basic Pricelists](groups/product.group_product_pricelist.md)
- [Manage Product Variants](groups/product.group_product_variant.md)
- [Lock Confirmed Sales](groups/sale.group_auto_done_setting.md)
- [Discount on lines](groups/sale.group_discount_per_so_line.md)
- [Pro-forma Invoices](groups/sale.group_proforma_sales.md)
- [A warning can be set on a product or a customer (Sale)](groups/sale.group_warning_sale.md)
- [Sales / Administrator](groups/sales_team.group_sale_manager.md)
- [Sales / User: Own Documents Only](groups/sales_team.group_sale_salesman.md)
- [Sales / User: All Documents](groups/sales_team.group_sale_salesman_all_leads.md)
- [Dashboard / Admin](groups/spreadsheet_dashboard.group_dashboard_manager.md)
- [Manage Multiple Units of Measure](groups/uom.group_uom.md)
