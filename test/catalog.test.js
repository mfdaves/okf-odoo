"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { CatalogError, DEFAULT_SECTIONS, FIELDS, readCatalog } = require("../src/catalog");
const { OdooError } = require("../src/odoo");
const { FIXTURE_OPTIONS, ReplayClient, VERSIONS } = require("./support/replay-client");

function snapshotPath(version) {
  return path.join(__dirname, `fixtures/odoo-${version}/catalog.txt`);
}

// One line per entry, so a change in normalisation shows as a readable diff.
function snapshot(catalog) {
  const lines = [];
  for (const [key, value] of Object.entries(catalog)) {
    if (!Array.isArray(value) || typeof value[0] !== "object") {
      lines.push(`${key}: ${JSON.stringify(value)}`);
      continue;
    }
    lines.push(`${key}:`);
    for (const entry of value) {
      const nested = key === "models" ? "fields" : key === "apps" ? "menus" : null;
      const { [nested]: children, ...rest } = entry;
      lines.push(`  ${JSON.stringify(nested ? rest : entry)}`);
      for (const child of nested ? children : []) lines.push(`    ${JSON.stringify(child)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

for (const version of VERSIONS) {
  test(`Odoo ${version}: the recorded responses normalise to the committed catalog snapshot`, async () => {
    const catalog = await readCatalog(ReplayClient.forVersion(version), FIXTURE_OPTIONS);
    const rendered = snapshot(catalog);
    if (process.env.UPDATE_SNAPSHOTS === "1") fs.writeFileSync(snapshotPath(version), rendered);
    assert.equal(rendered, fs.readFileSync(snapshotPath(version), "utf8"));
  });

  test(`Odoo ${version}: models carry their defining module, fields, access, and jobs`, async () => {
    const catalog = await readCatalog(ReplayClient.forVersion(version), FIXTURE_OPTIONS);
    assert.deepEqual(catalog.sections, [...FIXTURE_OPTIONS.sections]);
    assert.equal(catalog.accessModel, version === "19" ? "ir.model.access" : "ir.access");

    const team = catalog.models.find((model) => model.model === "crm.team");
    assert.equal(team.definedIn, "sales_team");
    assert.ok(team.modules.includes("sale"));
    const leader = team.fields.find((field) => field.name === "user_id");
    assert.equal(leader.type, "many2one");
    assert.equal(leader.relation, "res.users");
    const company = team.fields.find((field) => field.name === "company_id");
    assert.equal(company.index, version === "19" ? "indexed" : "btree");

    const restriction = team.access.find((entry) => entry.kind === "restriction");
    assert.deepEqual(restriction.groups, []);
    assert.match(restriction.domain, /company_ids/);
    assert.equal(restriction.operations, "crud");
    const reader = team.access.find((entry) => entry.groups[0]?.key === "base.group_user");
    assert.equal(reader.operations, "r");

    const users = catalog.models.find((model) => model.model === "res.users");
    assert.equal(users.definedIn, "base");
    assert.ok(users.modules.includes("sales_team"));
    assert.ok(users.crons.length >= 1);
    assert.ok(users.serverActions.length >= 1);

    const withSelection = catalog.models
      .flatMap((model) => model.fields)
      .find((field) => field.type === "selection" && field.selection.length);
    assert.ok(withSelection, "a selection field with recorded values");
    assert.ok(withSelection.selection.every((entry) => typeof entry.value === "string"));

    const manager = catalog.groups.find((group) => group.key === "sales_team.group_sale_manager");
    assert.ok(
      manager.implies.some((group) => group.key === "sales_team.group_sale_salesman_all_leads"),
    );

    const settings = catalog.apps.find((app) => app.key === "base.menu_administration");
    assert.ok(settings.menus.some((menu) => menu.action?.model === "res.users"));

    assert.ok(catalog.modules.some((module) => module.name === "sale" && !module.selected));
    assert.deepEqual(
      catalog.modules.filter((module) => module.selected).map((module) => module.name),
      ["sales_team", "utm"],
    );
  });

  test(`Odoo ${version}: only allowlisted fields are requested or reach the catalog`, async () => {
    const marker = "MUST-NOT-LEAK";
    const client = ReplayClient.forVersion(version, (_model, rows) =>
      rows.map((row) => ({
        code: marker,
        count: 987654321,
        nextcall: marker,
        webhook_url: marker,
        password: marker,
        ...row,
      })),
    );
    const catalog = await readCatalog(client, FIXTURE_OPTIONS);
    assert.doesNotMatch(JSON.stringify(catalog), new RegExp(`${marker}|987654321`));
    for (const call of client.calls) {
      assert.deepEqual(call.params.fields, FIELDS[call.model], call.model);
      assert.equal(call.params.context.lang, "en_US");
    }
    const requested = new Set(client.calls.map((call) => call.model));
    assert.equal(requested.has("ir.config_parameter"), false);
    assert.equal(FIELDS["ir.actions.server"].includes("code"), false);
    assert.equal(FIELDS["ir.cron"].includes("code"), false);
    assert.equal(FIELDS["ir.model"].includes("count"), false);
  });

  test(`Odoo ${version}: the catalog does not depend on the order rows arrive in`, async () => {
    const forward = await readCatalog(ReplayClient.forVersion(version), FIXTURE_OPTIONS);
    const reversed = await readCatalog(
      ReplayClient.forVersion(version, (_model, rows) => rows.reverse()),
      FIXTURE_OPTIONS,
    );
    assert.deepEqual(reversed, forward);
  });
}

test("module filters select models by the modules that define or extend them", async () => {
  const onlyUtm = await readCatalog(ReplayClient.forVersion("20"), {
    ...FIXTURE_OPTIONS,
    modules: { include: ["utm"] },
  });
  assert.ok(onlyUtm.models.every((model) => model.modules.includes("utm")));
  assert.ok(onlyUtm.models.some((model) => model.model === "utm.campaign"));
  assert.equal(
    onlyUtm.models.some((model) => model.model === "crm.team"),
    false,
  );
  assert.deepEqual(
    onlyUtm.modules.filter((module) => module.selected).map((module) => module.name),
    ["utm"],
  );

  const wildcard = await readCatalog(ReplayClient.forVersion("20"), {
    ...FIXTURE_OPTIONS,
    modules: { include: ["sales_*", "utm"], exclude: ["utm"] },
    otherModules: "none",
  });
  assert.deepEqual(
    wildcard.modules.map((module) => module.name),
    ["sales_team"],
  );
  assert.ok(wildcard.models.some((model) => model.model === "crm.team"));
  assert.equal(
    wildcard.models.some((model) => model.model === "utm.campaign"),
    false,
  );
  assert.equal(wildcard.modelIndex.length > wildcard.models.length, true);
});

test("an unselected section is never read", async () => {
  const client = ReplayClient.forVersion("19");
  const catalog = await readCatalog(client, { ...FIXTURE_OPTIONS, sections: ["groups"] });
  assert.deepEqual(catalog.sections, ["groups"]);
  assert.deepEqual(catalog.models, []);
  assert.deepEqual(catalog.modules, []);
  assert.ok(catalog.groups.length > 0);
  assert.deepEqual([...new Set(client.calls.map((call) => call.model))].sort(), [
    "ir.model.data",
    "res.groups",
  ]);
  assert.deepEqual(DEFAULT_SECTIONS.includes("serverActions"), false);
});

test("a section the key cannot read fails the run and names the section", async () => {
  const cases = [
    ["ir.cron", "crons"],
    ["ir.actions.act_window", "menus"],
    ["ir.actions.server", "serverActions"],
    ["ir.module.module", "modules"],
    ["ir.model.access", "access"],
    ["ir.model.fields", "models"],
  ];
  for (const [deniedModel, section] of cases) {
    const client = ReplayClient.forVersion("19", (model, rows) => {
      if (model === deniedModel) {
        throw new OdooError("access_denied", { model, method: "search_read", status: 403 });
      }
      return rows;
    });
    await assert.rejects(readCatalog(client, FIXTURE_OPTIONS), (error) => {
      assert.ok(error instanceof CatalogError, deniedModel);
      assert.equal(error.code, "access_denied");
      assert.equal(error.section, section, deniedModel);
      assert.match(error.message, new RegExp(`the ${section} section`));
      return true;
    });
  }
});

test("sections rendered on model concepts require the models section", async () => {
  await assert.rejects(
    readCatalog(ReplayClient.forVersion("19"), { sections: ["access"] }),
    /access section requires the models section/,
  );
});
