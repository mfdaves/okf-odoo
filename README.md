# okf-odoo

`okf-odoo` reads the technical metadata of an Odoo 19 or 20 database over
Odoo's JSON-2 API and produces an Open Knowledge Format v0.2 bundle with
explicit generation provenance.

It documents installed modules and their dependencies, models with their
fields and selection values, access rights and record rules, groups and the
groups they imply, top-level menus down to the models their window actions
open, scheduled jobs, reports and, on request, server actions. It never reads
business records, system parameter values or server-action code, and never
calls a method that writes.

The package is a Producer API v1 producer. It has no command line of its
own: a host such as [`okf-mcp`](https://github.com/mfdaves/okf-mcp) loads it,
validates the candidate bundle and publishes it through
`okf producer preview` and `okf producer run`.

## Requirements

- Node.js 22 or newer and `@mfdaves/okf-mcp` with Producer API v1.
- Odoo 19 or 20. The JSON-2 endpoint `/json/2/<model>/<method>` comes from
  the `rpc` module, which Odoo installs automatically.
- An Odoo API key (as the user interface creates them, or with the `rpc`
  scope) of a user allowed to read the selected sections.

## API key and access rights

What a key can read depends on its user's groups. Group names shown in the
tables are resolved through `res.groups` and `ir.model.data`, so every
section that shows groups reads those too. Measured on Odoo 19 and 20:

| Section | Odoo models read | Lowest group that can read it |
| --- | --- | --- |
| `modules` | `ir.module.module`, `ir.module.module.dependency` | Internal user |
| `models` | `ir.model`, `ir.model.data`, `ir.model.fields`, `ir.model.fields.selection`, `res.groups` | Administration: Access Rights |
| `access` | `ir.access` (Odoo 20) or `ir.model.access` and `ir.rule` (Odoo 19), `res.groups`, `ir.model.data` | Administration: Access Rights |
| `groups` | `res.groups`, `ir.model.data` | Administration: Access Rights |
| `reports` | `ir.actions.report`, `res.groups`, `ir.model.data` | Administration: Access Rights |
| `menus` | `ir.ui.menu`, `ir.actions.act_window`, `res.groups`, `ir.model.data` | Administration: Settings |
| `crons` | `ir.cron` | Administration: Settings |
| `serverActions` | `ir.actions.server` (name, model, type, binding, groups), `res.groups`, `ir.model.data` | Administration: Settings |

The default sections include `menus` and `crons`, so the full catalog needs
the API key of a Settings administrator. Use a dedicated technical user for
it rather than a person's account:

1. Create an internal user, for example `okf-reader`, and give it
   *Administration: Settings*.
2. Sign in as that user and create an API key from the user's preferences
   (*Account Security*). A Settings administrator may choose a key without
   an expiry date.
3. Put the key in an environment variable of the process that runs the host.
   Configuration names the variable, never the key.

A key whose user cannot read a selected section fails the run with
`access_denied` and the section's name. The producer never drops a section
silently; remove the section from `sections` to publish without it.

## Install

Install the producer next to the host in the project that owns the bundle:

```bash
npm install @mfdaves/okf-mcp @mfdaves/okf-odoo
```

## Configure

Declare the bundle, the relation types the producer emits, and the producer
in `okf.project.yaml`:

```yaml
project: Odoo catalog
bundles:
  - id: odoo
    root: okf/odoo
relationTypes:
  - defined_in
  - extended_by
  - references
  - implies
  - opens
producers:
  - name: odoo
    type: odoo
    package: "@mfdaves/okf-odoo"
    bundle: odoo
    config:
      url: https://odoo.example.com
      database: production
      apiKeyEnv: ODOO_API_KEY
      source: odoo-production
      modules:
        include: ["x_*"]
```

`depends_on`, the sixth relation type the producer emits, is built into
`okf-mcp`.

| Key | Default | Meaning |
| --- | --- | --- |
| `url` | required | Base URL of the Odoo server, `http` or `https`, without credentials, query or fragment. |
| `database` | none | Sent as the `X-Odoo-Database` header; needed when the server hosts several databases. |
| `apiKeyEnv` | `ODOO_API_KEY` | Name of the environment variable that holds the API key. |
| `source` | `odoo` | Stable, non-secret alias used in `odoo://` resource locators and in the index title. |
| `lang` | `en_US` | Language of labels, help texts and menu names. |
| `sections` | all but `serverActions` | Which parts of the catalog to read: `modules`, `models`, `access`, `groups`, `menus`, `crons`, `reports`, `serverActions`. `access`, `crons`, `reports` and `serverActions` are tables on model concepts and require `models`. |
| `modules.include` | every installed module | Module names to document in full; `*` matches any characters. |
| `modules.exclude` | none | Module names never documented, applied after `include`. |
| `otherModules` | `summary` | What happens to installed modules that `modules.include` does not select: `summary` renders a module concept without their own models, `none` leaves them out. |

A model is documented when one of the modules that define or extend it is
selected. Models created in the database, which belong to no module, are
documented only when `modules.include` is not set. Odoo cannot tell standard
modules from custom ones (manifest authors vary), so the selection is always
by name.

## Run

```bash
export ODOO_API_KEY=…
okf --project okf.project.yaml producer preview odoo
okf --project okf.project.yaml producer run odoo --write --actor process:odoo-refresh
```

`preview` reads the catalog and reports the publication diff without writing.
`run` publishes it. The host compares each file with the published one
ignoring `generated.at`, so a database whose metadata did not change reports
every file `unchanged`. The receipt's `summary` counts modules, models,
fields, access entries, groups, applications, scheduled jobs, reports, server
actions and files.

`okf-mcp` reports any exception from a producer as `producer_execution_failed`.
The specific code (`access_denied` with its `section`, `invalid_api_key`,
`model_not_found`, `json2_unavailable`, `timeout`, `connection_failed`) is on
the error `generate()` throws when it is called directly.

## Output

```text
index.md                 links to every concept below
modules/<name>.md        version, category, dependencies, models defined and extended
models/<model>.md        fields, selection values, access, scheduled jobs, reports, server actions
groups/<xmlid>.md        implied groups, groups implying it, access on documented models
apps/<xmlid>.md          a top-level menu, its submenus and the models they open
.okf-producer.json       written by the host: owned paths and digests
```

Groups and menus created in the database have no XML id and are named
`group-<id>` and `menu-<id>`. Typed relations: a model is `defined_in` the
module that registered it first and `extended_by` the others, and
`references` the models its relational fields point to; a module
`depends_on` its dependencies; a group `implies` other groups; an application
`opens` the models of its window actions. A relation or link is emitted only
when its target is part of the bundle.

Every concept carries `generated.by` (`okf-odoo/<version>`) and
`generated.at`, a `resource` such as `odoo://<source>/sale.order`, and
`sources` naming the Odoo models the metadata was read from. The server
address, database name and API key never appear in the output.

## Producer API

```js
const { okfProducer } = require("@mfdaves/okf-odoo");

const result = await okfProducer.generate({
  bundleId: "odoo",
  generatedAt: new Date().toISOString(),
  config: { url: "https://odoo.example.com", apiKeyEnv: "ODOO_API_KEY" },
  getSecret: (name) => process.env[name],
});
```

The descriptor declares API version 1, OKF version 0.2, id `odoo` and its
relation types. `validateConfig()` returns the normalised configuration and
one diagnostic per invalid key. `generate()` returns sorted
`{ path, content }` files and the numeric summary; it writes nothing.
`readCatalog()`, `buildBundle()` and `createOdooClient()` are exported for
reuse.

## Security boundary

- Only `fields_get`, `read` and `search_read` can be called, each read names
  its fields, and `ir.config_parameter` is refused by the client.
- Every field requested is listed in one allowlist per Odoo model
  (`FIELDS` in `src/catalog.js`); record counts, scheduling timestamps,
  server-action code and webhook URLs are not in it.
- Error messages carry a fixed text per code, never the server's response.
- The API key is read from the environment variable the host hands over and
  is never rendered.

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
npm run smoke
npm run self:validate
npm run pack:check
```

The unit tests replay JSON-2 responses recorded from Odoo 19 and 20 with
`base` and `sale` installed (`test/fixtures/odoo-<version>/calls.json`) and
compare the result with committed snapshots; `UPDATE_SNAPSHOTS=1 npm test`
rewrites them. `npm run smoke` and `npm run self:validate` need the sibling
`../okf-mcp` checkout; the smoke publishes the recordings through okf-mcp's
producer host and checks that a second run is unchanged.

The live gates run against a disposable Odoo in Docker (ports 18069 for 19
and 18070 for 20):

```bash
scripts/live-odoo.sh up 19 > odoo.env
set -a; . ./odoo.env; set +a
OKF_ODOO_LIVE_TEST=1 npm run live:shape
OKF_ODOO_LIVE_TEST=1 npm run live:smoke
npm run live:record            # re-record test/fixtures/odoo-19
scripts/live-odoo.sh down
```

`live:shape` compares the server's field types, requests and row shapes with
the recorded fixture. `live:smoke` publishes through `okf producer preview`
and `run` with the package linked into a project, checks the second run is
unchanged, and checks that a key of an Access Rights manager fails on the
`menus`, `crons` and `serverActions` sections.

## Release

Releases are published by the Release workflow from a dispatched tag with
npm provenance, through the trusted publisher configured on npm. npm cannot
configure a trusted publisher for a package that does not exist yet, so the
first version is published once by hand (`npm publish --access public`) and
the trusted publisher is configured afterwards.
