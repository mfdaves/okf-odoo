"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");
const { readCatalog } = require("../src/catalog");
const { RELATION_TYPES, buildBundle, safeSegment } = require("../src/render");
const { FIXTURE_OPTIONS, ReplayClient, VERSIONS } = require("./support/replay-client");
const { siblingAvailable, validateWithOkfMcp } = require("./support/okf-mcp");

const OPTIONS = { source: "erp", bundle: "erp", generatedAt: "2026-11-14T10:00:00Z" };
const SNAPSHOT_FILES = [
  "index.md",
  "models/crm.team.md",
  "modules/sales_team.md",
  "groups/sales_team.group_sale_manager.md",
  "apps/utm.menu_link_tracker_root.md",
];

function frontmatter(content) {
  return yaml.load(content.match(/^---\n([\s\S]*?)\n---\n/)[1]);
}

function manifest(files) {
  return `${[...files]
    .map(([file, content]) => {
      const digest = crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
      return `${digest} ${file}`;
    })
    .sort((left, right) => (left.slice(17) < right.slice(17) ? -1 : 1))
    .join("\n")}\n`;
}

async function fixtureBundle(version, options = OPTIONS) {
  const catalog = await readCatalog(ReplayClient.forVersion(version), FIXTURE_OPTIONS);
  return { catalog, files: buildBundle(catalog, options) };
}

// Every Markdown link and typed relation must land on a rendered concept.
function unresolved(files) {
  const problems = [];
  const ids = new Set([...files.keys()].map((file) => `okf://erp/${file.slice(0, -3)}`));
  for (const [file, content] of files) {
    const body = content.replace(/^---\n[\s\S]*?\n---\n/, "");
    // An escaped bracket is literal text, not the end of a link.
    for (const match of body.matchAll(/(?<!\\)\]\(([^)]+)\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
      if (!files.has(target)) problems.push(`${file}: link ${match[1]}`);
    }
    for (const relation of frontmatter(content).relations || []) {
      if (!ids.has(relation.target)) problems.push(`${file}: relation ${relation.target}`);
      if (!RELATION_TYPES.includes(relation.type)) problems.push(`${file}: type ${relation.type}`);
    }
  }
  return problems;
}

for (const version of VERSIONS) {
  test(`Odoo ${version}: the rendered bundle matches the committed snapshot`, async () => {
    const { files } = await fixtureBundle(version);
    const directory = path.join(__dirname, `fixtures/odoo-${version}/bundle`);
    const update = process.env.UPDATE_SNAPSHOTS === "1";
    if (update) {
      fs.rmSync(directory, { recursive: true, force: true });
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, "manifest.txt"), manifest(files));
    }
    assert.equal(manifest(files), fs.readFileSync(path.join(directory, "manifest.txt"), "utf8"));
    for (const file of SNAPSHOT_FILES) {
      const snapshot = path.join(directory, file);
      if (update) {
        fs.mkdirSync(path.dirname(snapshot), { recursive: true });
        fs.writeFileSync(snapshot, files.get(file));
      }
      assert.equal(files.get(file), fs.readFileSync(snapshot, "utf8"), file);
    }
  });

  test(`Odoo ${version}: links and relations resolve and only generated.at varies`, async () => {
    const { catalog, files } = await fixtureBundle(version);
    assert.deepEqual(unresolved(files), []);
    const later = buildBundle(catalog, { ...OPTIONS, generatedAt: "2027-01-01T00:00:00Z" });
    assert.deepEqual([...later.keys()], [...files.keys()]);
    for (const [file, content] of files) {
      const strip = (text) => text.replace(/^ {2}at: .*$/m, "");
      assert.equal(strip(later.get(file)), strip(content), file);
    }
    const team = files.get("models/crm.team.md");
    const note = /Field groups are not available on Odoo/;
    if (version === "20") assert.doesNotMatch(team, note);
    else assert.match(team, new RegExp(`Field groups are not available on Odoo ${version}:`));
    const kind =
      version === "18"
        ? /Kind: model or abstract model \(Odoo 18 does not record which\)/
        : /Kind: model\n/;
    assert.match(team, kind);
    // x2many fields have no column, whatever ir.model.fields says about storing them.
    assert.match(
      team,
      /\| `crm_team_member_ids` \|[^\n]*\| not stored \(no column\), not groupable \|/,
    );
    assert.match(
      team,
      /\| `dashboard_button_name` \|[^\n]*not stored, not searchable, not groupable/,
    );
    assert.match(team, /\| `user_id` \|[^\n]*\| stored, on delete set null \|/);
    const manager = files.get("groups/sales_team.group_sale_manager.md");
    assert.match(manager, version === "18" ? /- Application: Sales/ : /- Privilege: Sales/);
    assert.deepEqual(frontmatter(files.get("index.md")), { okf_version: "0.2" });
    for (const [file, content] of files) {
      if (file === "index.md") continue;
      const meta = frontmatter(content);
      assert.equal(meta.id, `okf://erp/${file.slice(0, -3)}`);
      assert.ok(meta.type && meta.title && meta.description, file);
      assert.ok(
        meta.sources.every((source) => source.resource.startsWith("odoo://erp/")),
        file,
      );
      assert.match(meta.generated.by, /^okf-odoo\//);
    }
  });

  test(`Odoo ${version}: okf-mcp validates the bundle with the producer's relation types`, {
    skip: siblingAvailable() ? false : "requires the sibling ../okf-mcp checkout",
  }, async () => {
    const { files } = await fixtureBundle(version);
    const outcome = validateWithOkfMcp(files);
    assert.equal(outcome.status, 0, outcome.stderr || JSON.stringify(outcome.result?.diagnostics));
    assert.equal(outcome.result.valid, true);
    assert.deepEqual(outcome.result.warnings, []);
  });
}

function syntheticCatalog() {
  return {
    sections: ["modules", "models", "access", "groups", "menus", "reports", "serverActions"],
    accessModel: "ir.access",
    modules: [
      {
        name: "x_shop",
        title: "Shop | Custom",
        summary: null,
        version: "20.0.1.0",
        diskVersion: "20.0.1.1",
        category: null,
        application: true,
        autoInstall: false,
        license: "LGPL-3",
        dependencies: ["base", "missing_module"],
        selected: true,
      },
      {
        name: "base",
        title: "Base",
        summary: "The kernel",
        version: "20.0.1.3",
        diskVersion: "20.0.1.3",
        category: "Technical",
        application: false,
        autoInstall: true,
        license: "LGPL-3",
        dependencies: [],
        selected: false,
      },
    ],
    modelIndex: [
      {
        model: "x.order",
        name: "Order",
        kind: "model",
        custom: false,
        modules: ["x_shop"],
        definedIn: "x_shop",
      },
      {
        model: "x_manual",
        name: "Manual",
        kind: "model",
        custom: true,
        modules: [],
        definedIn: null,
      },
    ],
    models: [
      {
        model: "x.order",
        name: "Order",
        kind: "model",
        custom: false,
        modules: ["x_shop"],
        definedIn: "x_shop",
        fields: [
          {
            name: "state",
            label: "State | phase",
            type: "selection",
            relation: null,
            relationField: null,
            required: true,
            readonly: false,
            stored: true,
            index: "btree_not_null",
            translate: null,
            related: null,
            help: "Line one\nline two <b> [see](elsewhere.md)",
            custom: false,
            companyDependent: false,
            searchable: true,
            onDelete: null,
            modules: ["x_shop"],
            groups: [{ key: "x_shop.group_manager", name: "Shop / Manager" }],
            selection: [
              { value: "draft", label: "Draft" },
              { value: "done", label: "Done" },
            ],
          },
          {
            name: "x_note",
            label: "Note",
            type: "many2one",
            relation: "x_manual",
            relationField: null,
            required: false,
            readonly: false,
            stored: true,
            index: null,
            translate: "standard",
            related: null,
            help: null,
            custom: true,
            companyDependent: true,
            searchable: false,
            onDelete: "set null",
            modules: [],
            groups: [],
            selection: [],
          },
        ],
        access: [
          {
            name: "everyone reads own",
            kind: "restriction",
            groups: [],
            operations: "r",
            domain: "[('user_id', '=', uid)]",
          },
          {
            name: "managers",
            kind: "permission",
            groups: [{ key: "x_shop.group_manager", name: "Shop / Manager" }],
            operations: "crud",
            domain: null,
          },
        ],
        crons: [],
        reports: [
          { name: "Order sheet", reportName: "x_shop.report_order", type: "qweb-pdf", groups: [] },
        ],
        serverActions: [{ name: "Confirm", type: "object_write", bound: true, groups: [] }],
      },
    ],
    groups: [
      {
        key: "x_shop.group_manager",
        xmlid: "x_shop.group_manager",
        name: "Manager",
        fullName: "Shop / Manager",
        privilege: "Shop",
        comment: null,
        share: false,
        implies: [{ key: "group-77", name: "Ad hoc" }],
      },
      {
        key: "group-77",
        xmlid: null,
        name: "Ad hoc",
        fullName: "Ad hoc",
        privilege: null,
        comment: "Made in the [user interface](ui.md)",
        share: false,
        implies: [],
      },
    ],
    apps: [
      {
        key: "menu-12",
        xmlid: null,
        name: "Shop / Ops",
        sequence: 1,
        action: null,
        groups: [],
        menus: [
          {
            path: ["Orders"],
            depth: 1,
            action: { type: "ir.actions.act_window", name: "Orders", model: "x.order" },
            groups: [],
          },
          {
            path: ["Orders", "Dashboard"],
            depth: 2,
            action: { type: "ir.actions.client", name: null, model: null },
            groups: [{ key: "x_shop.group_manager", name: "Shop / Manager" }],
          },
        ],
      },
    ],
  };
}

test("rendering covers every section and escapes untrusted text", () => {
  const files = buildBundle(syntheticCatalog(), OPTIONS);
  assert.deepEqual(
    [...files.keys()],
    [
      "index.md",
      "modules/x_shop.md",
      "modules/base.md",
      "models/x.order.md",
      "groups/x_shop.group_manager.md",
      "groups/group-77.md",
      "apps/menu-12.md",
    ],
  );
  assert.deepEqual(unresolved(files), []);
  if (siblingAvailable()) {
    const outcome = validateWithOkfMcp(files);
    assert.equal(outcome.status, 0, JSON.stringify(outcome.result?.diagnostics));
    assert.deepEqual(outcome.result.warnings, []);
  }
  const order = files.get("models/x.order.md");
  assert.match(order, /State \\\| phase/);
  assert.match(order, /required, stored, indexed \(btree_not_null\)/);
  assert.match(order, /\| Line one line two \\<b> \\\[see\\\]\(elsewhere\.md\) \|/);
  assert.match(order, /groups: \[Shop \/ Manager\]\(\.\.\/groups\/x_shop\.group_manager\.md\)/);
  assert.match(order, /\| `x_manual` \|/);
  assert.match(
    order,
    /stored, not searchable, translated \(standard\).*company-dependent.*on delete set null, custom/,
  );
  assert.match(
    order,
    /follow from how a field is stored; odoo_describe_model gives the exact flags/,
  );
  assert.match(order, /### `state`\n\n- `draft` — Draft\n- `done` — Done/);
  assert.match(order, /\| restriction \| everyone \| read \| `\[\('user_id', '=', uid\)\]` \|/);
  assert.match(order, /permission \| \[Shop \/ Manager\].* \| create, read, update, delete \| —/);
  assert.match(order, /\| Order sheet \| `x_shop\.report_order` \| `qweb-pdf` \|/);
  assert.match(order, /\| Confirm \| `object_write` \| yes \|/);
  assert.doesNotMatch(order, /## Scheduled jobs/);
  const meta = frontmatter(order);
  assert.deepEqual(meta.relations, [{ type: "defined_in", target: "okf://erp/modules/x_shop" }]);
  assert.equal(meta.resource, "odoo://erp/x.order");
  assert.deepEqual(
    meta.sources.map((source) => source.resource),
    [
      "odoo://erp/ir.model",
      "odoo://erp/ir.model.fields",
      "odoo://erp/ir.access",
      "odoo://erp/ir.actions.report",
      "odoo://erp/ir.actions.server",
    ],
  );

  const shop = files.get("modules/x_shop.md");
  assert.match(shop, /Version on disk: `20\.0\.1\.1` \(differs from the installed version\)/);
  assert.doesNotMatch(shop, /upgrade/);
  assert.match(shop, /- `missing_module`/);
  assert.deepEqual(frontmatter(shop).relations, [
    { type: "depends_on", target: "okf://erp/modules/base" },
  ]);
  assert.equal(frontmatter(shop).title, "Shop | Custom (x_shop)");

  const manager = files.get("groups/x_shop.group_manager.md");
  assert.deepEqual(frontmatter(manager).relations, [
    { type: "implies", target: "okf://erp/groups/group-77" },
  ]);
  assert.match(files.get("groups/group-77.md"), /No XML id \(created in the database\)/);
  assert.match(files.get("groups/group-77.md"), /Made in the \\\[user interface\\\]\(ui\.md\)/);
  assert.match(files.get("groups/group-77.md"), /Implied by\n\n- \[Shop \/ Manager\]/);

  const app = files.get("apps/menu-12.md");
  assert.match(
    app,
    /- Orders → \[x\.order\]\(\.\.\/models\/x\.order\.md\)\n {2}- Dashboard \(`ir\.actions\.client`\) — groups:/,
  );
  assert.deepEqual(frontmatter(app).relations, [
    { type: "opens", target: "okf://erp/models/x.order" },
  ]);
});

test("names differing only by case get paths that differ without case", () => {
  assert.equal(safeSegment("m.group_x"), "m.group_x");
  assert.match(safeSegment("m.group_X"), /^m\.group_X--[a-f0-9]{8}$/);
  const catalog = syntheticCatalog();
  const manager = catalog.groups[0];
  catalog.groups.push(
    { ...manager, key: "m.group_X", xmlid: "m.group_X", fullName: "Upper", implies: [] },
    { ...manager, key: "m.group_x", xmlid: "m.group_x", fullName: "Lower", implies: [] },
  );
  catalog.groups[1].implies = [
    { key: "m.group_X", name: "Upper" },
    { key: "m.group_x", name: "Lower" },
  ];
  const files = buildBundle(catalog, OPTIONS);
  const groups = [...files.keys()].filter((file) => file.startsWith("groups/m.group_"));
  assert.equal(groups.length, 2);
  assert.equal(new Set(groups.map((file) => file.toLowerCase())).size, 2);
  assert.ok(groups.includes("groups/m.group_x.md"));
  assert.deepEqual(unresolved(files), []);
  assert.match(files.get("groups/group-77.md"), /\[Upper\]\(m\.group_X--[a-f0-9]{8}\.md\)/);
  if (siblingAvailable()) assert.equal(validateWithOkfMcp(files).status, 0);
});

test("modules named index or log do not take the reserved file names", () => {
  for (const name of ["index", "log", "INDEX", "Log"]) {
    assert.match(safeSegment(name), new RegExp(`^${name}--[a-f0-9]{8}$`));
  }
  const catalog = syntheticCatalog();
  catalog.modules.push(
    { ...catalog.modules[1], name: "index", title: "Index", selected: false },
    { ...catalog.modules[1], name: "log", title: "Log", selected: false },
  );
  catalog.modules[0].dependencies.push("index", "log");
  const files = buildBundle(catalog, OPTIONS);
  const modules = [...files.keys()].filter((file) => file.startsWith("modules/"));
  assert.ok(
    modules.every((file) => !/\/(index|log)\.md$/.test(file)),
    modules.join(" "),
  );
  assert.equal(
    modules.filter((file) => /^modules\/(index|log)--[a-f0-9]{8}\.md$/.test(file)).length,
    2,
  );
  assert.deepEqual(unresolved(files), []);
  if (siblingAvailable()) {
    const outcome = validateWithOkfMcp(files);
    assert.equal(outcome.status, 0, JSON.stringify(outcome.result?.diagnostics));
  }
});

test("two concepts on one path, with or without case, are refused", () => {
  const same = syntheticCatalog();
  same.groups.push({ ...same.groups[1] });
  assert.throws(() => buildBundle(same, OPTIONS), /same path/);
  // A lowercase name that spells another name's hashed segment in lowercase.
  const folded = syntheticCatalog();
  const upper = safeSegment("G");
  folded.groups.push(
    { ...folded.groups[1], key: "G", xmlid: "G" },
    { ...folded.groups[1], key: upper.toLowerCase(), xmlid: upper.toLowerCase() },
  );
  assert.notEqual(upper, upper.toLowerCase());
  assert.throws(() => buildBundle(folded, OPTIONS), /same path/);
});

test("unsafe identifiers receive stable disambiguated paths", () => {
  assert.equal(safeSegment("sale.order"), "sale.order");
  assert.match(safeSegment("Shop / Ops"), /^Shop-Ops--[a-f0-9]{8}$/);
  assert.notEqual(safeSegment("Shop / Ops"), safeSegment("Shop - Ops"));
  assert.match(safeSegment("../etc"), /^etc--[a-f0-9]{8}$/);
  assert.throws(
    () => buildBundle(syntheticCatalog(), { ...OPTIONS, source: "a/b" }),
    /identifiers/,
  );
});

function actionsCatalog() {
  const catalog = syntheticCatalog();
  catalog.sections = [...catalog.sections, "mcpActions"];
  catalog.mcpActions = [
    {
      name: "confirm-order",
      title: "Confirm an order",
      description: "Confirms an order | the customer accepted.",
      kind: "method",
      model: "x.order",
      wizard: null,
      minRecords: 1,
      maxRecords: 5,
      groups: [{ key: "x_shop.group_manager", name: "Shop / Manager" }],
      summary: "Presses the button action_confirm on 1 to 5 records of Order (x.order).",
      problem: null,
      inputs: [],
      steps: ["action_confirm"],
      fixed: [],
    },
    {
      name: "move-order",
      title: "Move an order <b>later</b>",
      description: null,
      kind: "wizard",
      model: "x.order",
      wizard: "x.order.move",
      minRecords: 1,
      maxRecords: 1,
      groups: [],
      summary: "Opens the wizard Move (x.order.move) for one record of Order (x.order).",
      problem: "x.order.move has no method action_apply.",
      inputs: [
        {
          name: "kind",
          label: "Kind | of move",
          type: "selection",
          relation: null,
          required: false,
          selection: [
            { key: "soon", label: "Soon" },
            { key: "late", label: "Late | r" },
          ],
          help: null,
        },
        {
          name: "order_id",
          label: "Other order",
          type: "many2one",
          relation: "x.order",
          required: false,
          selection: [],
          help: null,
        },
        {
          name: "reason",
          label: "Reason",
          type: "text",
          relation: null,
          required: true,
          selection: [],
          help: null,
        },
      ],
      steps: ["action_review", "action_apply"],
      fixed: [{ name: "operation", value: '"move"' }],
    },
    {
      name: "generate",
      title: "Generate",
      description: "Generates the plan.",
      kind: "wizard",
      model: null,
      wizard: "x.generate",
      minRecords: 0,
      maxRecords: 0,
      groups: [],
      summary: null,
      problem: null,
      inputs: [],
      steps: ["action_generate"],
      fixed: [],
    },
  ];
  return catalog;
}

test("exposed actions become concepts linked from their model and the index", () => {
  const files = buildBundle(actionsCatalog(), OPTIONS);
  assert.deepEqual(
    [...files.keys()].filter((file) => file.startsWith("actions/")),
    ["actions/confirm-order.md", "actions/move-order.md", "actions/generate.md"],
  );
  assert.deepEqual(unresolved(files), []);
  if (siblingAvailable()) {
    const outcome = validateWithOkfMcp(files);
    assert.equal(outcome.status, 0, JSON.stringify(outcome.result?.diagnostics));
    assert.deepEqual(outcome.result.warnings, []);
  }
  const confirm = files.get("actions/confirm-order.md");
  assert.match(confirm, /^id: okf:\/\/erp\/actions\/confirm-order$/m);
  assert.match(confirm, /^type: Odoo Action$/m);
  assert.match(confirm, /^resource: odoo:\/\/erp\/o3p\.mcp\.action\/confirm-order$/m);
  assert.match(confirm, /- type: references\n\s+target: okf:\/\/erp\/models\/x\.order/);
  assert.match(confirm, /^# Confirm an order \(`confirm-order`\)$/m);
  assert.match(confirm, /^Confirms an order \\\| the customer accepted\.$/m);
  assert.match(confirm, /^- Kind: record button$/m);
  assert.match(
    confirm,
    /^- Runs on: 1 to 5 records of \[x\.order\]\(\.\.\/models\/x\.order\.md\) per call$/m,
  );
  assert.match(
    confirm,
    /^- Only for: \[Shop \/ Manager\]\(\.\.\/groups\/x_shop\.group_manager\.md\)$/m,
  );
  assert.match(confirm, /^Nothing: the action takes no values\.$/m);
  assert.match(confirm, /^Buttons pressed, in order: `action_confirm`\.$/m);
  assert.match(confirm, /`odoo_run_action`/);
  assert.doesNotMatch(confirm, /Cannot run/);

  const move = files.get("actions/move-order.md");
  // Untrusted text is escaped in the body: no raw HTML, no broken table.
  assert.match(move, /^# Move an order \\<b>later\\<\/b> \(`move-order`\)$/m);
  assert.match(move, /^- Runs on: 1 record of \[x\.order\]/m);
  // The wizard is not a documented model here, so it is named, not linked.
  assert.match(move, /^- Wizard: `x\.order\.move`$/m);
  assert.match(move, /^- Only for: every user Odoo lets change these records$/m);
  assert.match(
    move,
    /^- Cannot run as it is defined: x\.order\.move has no method action_apply\.$/m,
  );
  assert.match(
    move,
    /^\| `kind` \| Kind \\\| of move \| `selection` \| no \| `soon` \(Soon\), `late` \(Late \\\| r\) \|$/m,
  );
  assert.match(
    move,
    /^\| `order_id` \| Other order \| `many2one` \| no \| a record of \[x\.order\]\(\.\.\/models\/x\.order\.md\) \|$/m,
  );
  assert.match(move, /^\| `reason` \| Reason \| `text` \| yes \| — \|$/m);
  assert.match(move, /^- `operation` = `"move"`$/m);
  assert.match(move, /^Buttons pressed, in order: `action_review`, `action_apply`\.$/m);

  const generate = files.get("actions/generate.md");
  assert.match(generate, /^- Runs on: no record$/m);
  assert.match(generate, /^Not available\.$/m);
  assert.doesNotMatch(generate, /^relations:/m);

  const order = files.get("models/x.order.md");
  assert.match(order, /^## Exposed actions$/m);
  assert.match(
    order,
    /^- \[Confirm an order\]\(\.\.\/actions\/confirm-order\.md\) \(`confirm-order`\)$/m,
  );
  assert.match(order, /actions\/move-order\.md/);
  assert.doesNotMatch(order, /actions\/generate\.md/);
  const index = files.get("index.md");
  assert.match(index, /^## Exposed actions$/m);
  assert.match(index, /^- \[Generate\]\(actions\/generate\.md\) — `generate`$/m);

  // Without the section nothing about actions is written.
  const plain = buildBundle(syntheticCatalog(), OPTIONS);
  assert.equal(
    [...plain.keys()].some((file) => file.startsWith("actions/")),
    false,
  );
  assert.doesNotMatch(plain.get("models/x.order.md"), /Exposed actions/);
  assert.doesNotMatch(plain.get("index.md"), /Exposed actions/);
});
