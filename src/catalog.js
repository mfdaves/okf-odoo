"use strict";

// Reads the technical catalog of an Odoo database into one normalised shape
// for Odoo 18, 19 and 20. Every value comes from a field named in the
// allowlist of the server's version; nothing else a response carries reaches
// the catalog.

const { OdooError } = require("./odoo");

const SECTIONS = Object.freeze([
  "modules",
  "models",
  "access",
  "groups",
  "menus",
  "crons",
  "reports",
  "serverActions",
]);
const DEFAULT_SECTIONS = Object.freeze(SECTIONS.filter((section) => section !== "serverActions"));
// These are rendered on model concepts, so they need the models section.
const MODEL_SECTIONS = Object.freeze(["access", "crons", "reports", "serverActions"]);

// The allowlist: the only fields ever requested, per Odoo model, as of Odoo 19.
const BASE_FIELDS = Object.freeze({
  "ir.module.module": [
    "name",
    "shortdesc",
    "summary",
    "latest_version",
    "installed_version",
    "category_id",
    "application",
    "auto_install",
    "license",
  ],
  "ir.module.module.dependency": ["module_id", "name"],
  "ir.model": ["model", "name", "modules", "transient", "abstract", "state"],
  "ir.model.data": ["module", "name", "res_id"],
  "ir.model.fields": [
    "model_id",
    "name",
    "field_description",
    "ttype",
    "relation",
    "relation_field",
    "required",
    "readonly",
    "store",
    "index",
    "translate",
    "related",
    "help",
    "state",
    "modules",
    "groups",
    "company_dependent",
    "on_delete",
    "selectable",
  ],
  "ir.model.fields.selection": ["field_id", "value", "name", "sequence"],
  "ir.access": ["name", "model_id", "group_id", "operation", "domain", "kind"],
  "ir.model.access": [
    "name",
    "model_id",
    "group_id",
    "perm_read",
    "perm_write",
    "perm_create",
    "perm_unlink",
  ],
  "ir.rule": [
    "name",
    "model_id",
    "groups",
    "domain_force",
    "perm_read",
    "perm_write",
    "perm_create",
    "perm_unlink",
  ],
  "res.groups": ["name", "full_name", "comment", "share", "privilege_id", "implied_ids"],
  "ir.ui.menu": ["name", "parent_id", "action", "sequence", "group_ids"],
  "ir.actions.act_window": ["name", "res_model"],
  "ir.cron": ["cron_name", "model_id", "interval_number", "interval_type", "active", "priority"],
  "ir.actions.report": ["name", "model", "report_type", "report_name", "group_ids"],
  "ir.actions.server": ["name", "model_id", "state", "binding_model_id", "group_ids"],
});

function withoutModels(fields, ...models) {
  return Object.fromEntries(Object.entries(fields).filter(([model]) => !models.includes(model)));
}

function renamed(list, from, to) {
  return list.map((field) => (field === from ? to : field)).filter(Boolean);
}

// What differs between the supported versions, measured on live servers.
// Odoo 18 has no ir.model.abstract, groups by application category, and
// groups_id where 19 has group_ids; Odoo 20 replaces ir.model.access and
// ir.rule with ir.access. Odoo 18 and 19 leave ir.model.fields.groups empty
// for fields defined in code, so their field groups say nothing.
const VERSIONS = Object.freeze({
  18: Object.freeze({
    accessModel: "ir.model.access",
    fieldGroups: false,
    groupCategory: "category_id",
    groupsField: "groups_id",
    fields: Object.freeze({
      ...withoutModels(BASE_FIELDS, "ir.access"),
      "ir.model": renamed(BASE_FIELDS["ir.model"], "abstract", null),
      "res.groups": renamed(BASE_FIELDS["res.groups"], "privilege_id", "category_id"),
      "ir.ui.menu": renamed(BASE_FIELDS["ir.ui.menu"], "group_ids", "groups_id"),
      "ir.actions.report": renamed(BASE_FIELDS["ir.actions.report"], "group_ids", "groups_id"),
      "ir.actions.server": renamed(BASE_FIELDS["ir.actions.server"], "group_ids", "groups_id"),
    }),
  }),
  19: Object.freeze({
    accessModel: "ir.model.access",
    fieldGroups: false,
    groupCategory: "privilege_id",
    groupsField: "group_ids",
    fields: Object.freeze(withoutModels(BASE_FIELDS, "ir.access")),
  }),
  20: Object.freeze({
    accessModel: "ir.access",
    fieldGroups: true,
    groupCategory: "privilege_id",
    groupsField: "group_ids",
    fields: Object.freeze(withoutModels(BASE_FIELDS, "ir.model.access", "ir.rule")),
  }),
});
const SUPPORTED_VERSIONS = Object.freeze(Object.keys(VERSIONS));

function fieldsFor(version) {
  const shape = VERSIONS[version];
  if (!shape) throw new TypeError(`Unsupported Odoo version: ${version}.`);
  return shape.fields;
}

class CatalogError extends Error {
  constructor(code, section, cause) {
    const reason =
      code === "access_denied"
        ? `The API key's user may not read the ${section} section.`
        : `Reading the ${section} section failed: ${cause ? cause.message : code}`;
    super(reason);
    this.name = "CatalogError";
    this.code = code;
    this.section = section;
  }
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function many2oneId(value) {
  return Array.isArray(value) && Number.isInteger(value[0]) ? value[0] : null;
}

function many2oneName(value) {
  return Array.isArray(value) ? text(value[1]) : null;
}

function ids(value) {
  return Array.isArray(value) ? value.filter(Number.isInteger) : [];
}

function moduleList(value) {
  return [
    ...new Set(
      String(value || "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// Orders by the given keys, then by the whole entry, so the result never
// depends on the order Odoo returned the rows in.
function byKey(...keys) {
  return (left, right) => {
    for (const key of keys) {
      const order = compare(key(left), key(right));
      if (order) return order;
    }
    return compare(JSON.stringify(left), JSON.stringify(right));
  };
}

function patternMatcher(patterns) {
  const expressions = (patterns || []).map(
    (pattern) => new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`),
  );
  return (name) => expressions.some((expression) => expression.test(name));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function operationsFromPerms(row) {
  return [
    row.perm_create ? "c" : "",
    row.perm_read ? "r" : "",
    row.perm_write ? "u" : "",
    row.perm_unlink ? "d" : "",
  ].join("");
}

// Odoo 19 stores a boolean (indexed or not); Odoo 20 names the index kind.
function indexKind(value) {
  if (value === true) return "indexed";
  return text(value);
}

function normalizeOptions(options = {}) {
  const sections = Array.isArray(options.sections) ? options.sections : DEFAULT_SECTIONS;
  return {
    sections: new Set(sections),
    include: options.modules?.include?.length ? options.modules.include : null,
    exclude: options.modules?.exclude || [],
    otherModules: options.otherModules || "summary",
    lang: options.lang || "en_US",
  };
}

async function readCatalog(client, options = {}) {
  if (!client || typeof client.searchRead !== "function") {
    throw new TypeError("An Odoo client with searchRead() is required.");
  }
  const config = normalizeOptions(options);
  const has = (section) => config.sections.has(section);
  const orphan = MODEL_SECTIONS.find((section) => has(section) && !has("models"));
  if (orphan) throw new TypeError(`The ${orphan} section requires the models section.`);
  const context = { lang: config.lang };
  let shape = null;
  const read = (model, domain, extra = {}) =>
    client.searchRead(model, {
      domain,
      fields: (shape ? shape.fields : BASE_FIELDS)[model],
      context: { ...context, ...extra },
    });
  const included = config.include ? patternMatcher(config.include) : () => true;
  const excluded = patternMatcher(config.exclude);
  const selectedModule = (name) => included(name) && !excluded(name);

  async function inSection(section, work) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      if (error instanceof OdooError) throw new CatalogError(error.code, section, error);
      throw error;
    }
  }

  // Lookups shared by several sections, read once by whichever needs them first.
  const memo = new Map();
  const once = (key, work) => {
    if (!memo.has(key)) memo.set(key, work());
    return memo.get(key);
  };
  const xmlids = (model) =>
    once(`xmlids:${model}`, async () => {
      const rows = await read("ir.model.data", [["model", "=", model]]);
      const byId = new Map();
      rows
        .slice()
        .sort(byKey((row) => row.id))
        .forEach((row) => {
          const resId = Number(row.res_id);
          if (!byId.has(resId)) byId.set(resId, `${row.module}.${row.name}`);
        });
      return byId;
    });
  const groupIndex = () =>
    once("groups", async () => {
      const [rows, keys] = await Promise.all([read("res.groups", []), xmlids("res.groups")]);
      const index = new Map();
      rows.forEach((row) => {
        const xmlid = keys.get(row.id) || null;
        index.set(row.id, {
          key: xmlid || `group-${row.id}`,
          xmlid,
          name: text(row.name) || `Group ${row.id}`,
          fullName: text(row.full_name) || text(row.name) || `Group ${row.id}`,
          privilege: many2oneName(row[shape.groupCategory]),
          comment: text(row.comment),
          share: row.share === true,
          impliedIds: ids(row.implied_ids),
        });
      });
      return index;
    });
  const groupRefs = async (value) => {
    const index = await groupIndex();
    return ids(value)
      .map((id) => index.get(id))
      .filter(Boolean)
      .map((group) => ({ key: group.key, name: group.fullName }))
      .sort(byKey((group) => group.key));
  };

  // The installed version of base names the server's major version, which
  // decides the allowlist. Any internal user can read it.
  const version = await inSection("version", async () => {
    const [base] = await read("ir.module.module", [["name", "=", "base"]]);
    const major = /^(\d+)\./.exec(String(base?.latest_version || ""))?.[1] || "unknown";
    if (!VERSIONS[major]) throw new CatalogError("unsupported_odoo_version", "version");
    return major;
  });
  shape = VERSIONS[version];

  const catalog = {
    sections: SECTIONS.filter(has),
    odooVersion: version,
    accessModel: shape.accessModel,
    fieldGroups: shape.fieldGroups,
    modules: [],
    modelIndex: [],
    models: [],
    groups: [],
    apps: [],
  };

  // Models, their fields and the module that defines each of them.
  let modelById = new Map();
  let selectedById = new Map();
  if (has("models")) {
    await inSection("models", async () => {
      const [rows, data] = await Promise.all([
        read("ir.model", []),
        read("ir.model.data", [["model", "=", "ir.model"]]),
      ]);
      const owners = new Map();
      data
        .slice()
        .sort(byKey((row) => row.id))
        .forEach((row) => {
          const resId = Number(row.res_id);
          if (!owners.has(resId)) owners.set(resId, []);
          owners.get(resId).push(String(row.module));
        });
      const abstractKnown = shape.fields["ir.model"].includes("abstract");
      catalog.modelIndex = rows
        .map((row) => {
          const modules = moduleList(row.modules);
          // The first module to register the model defines it; later ones extend it.
          const definedIn = (owners.get(row.id) || []).find((name) => modules.includes(name));
          return {
            id: row.id,
            model: String(row.model),
            name: text(row.name) || String(row.model),
            // Odoo 18 does not record which models are abstract.
            kind: row.transient
              ? "transient"
              : !abstractKnown
                ? null
                : row.abstract
                  ? "abstract"
                  : "model",
            custom: row.state === "manual",
            modules,
            definedIn: definedIn || null,
          };
        })
        .sort(byKey((model) => model.model));
      modelById = new Map(catalog.modelIndex.map((model) => [model.id, model]));

      const selected = catalog.modelIndex.filter((model) =>
        model.modules.length ? model.modules.some(selectedModule) : !config.include,
      );
      selectedById = new Map(
        selected.map((model) => [
          model.id,
          {
            model: model.model,
            name: model.name,
            kind: model.kind,
            custom: model.custom,
            modules: model.modules,
            definedIn: model.definedIn,
            fields: [],
            access: [],
            crons: [],
            reports: [],
            serverActions: [],
          },
        ]),
      );
      catalog.models = [...selectedById.values()];
      if (!selected.length) return;

      const fieldRows = await read("ir.model.fields", [
        ["model_id", "in", selected.map((model) => model.id)],
      ]);
      const selectionIds = fieldRows
        .filter((row) => row.ttype === "selection")
        .map((row) => row.id);
      const selectionRows = selectionIds.length
        ? await read("ir.model.fields.selection", [["field_id", "in", selectionIds]])
        : [];
      const selections = new Map();
      selectionRows
        .slice()
        .sort(
          byKey(
            (row) => Number(row.sequence) || 0,
            (row) => row.id,
          ),
        )
        .forEach((row) => {
          const fieldId = many2oneId(row.field_id);
          if (!selections.has(fieldId)) selections.set(fieldId, []);
          selections.get(fieldId).push({ value: String(row.value), label: text(row.name) });
        });
      for (const row of fieldRows) {
        const model = selectedById.get(many2oneId(row.model_id));
        if (!model) continue;
        model.fields.push({
          name: String(row.name),
          label: text(row.field_description),
          type: String(row.ttype),
          relation: text(row.relation),
          relationField: text(row.relation_field),
          required: row.required === true,
          readonly: row.readonly === true,
          stored: row.store === true,
          index: indexKind(row.index),
          // A boolean on Odoo 18, the kind of translation on 19 and 20.
          translate: row.translate === true ? "translated" : text(row.translate),
          related: text(row.related),
          help: text(row.help),
          custom: row.state === "manual",
          companyDependent: row.company_dependent === true,
          // Odoo reflects "stored or has a search method" as selectable.
          searchable: row.selectable === true,
          onDelete: text(row.on_delete),
          modules: moduleList(row.modules),
          groups: await groupRefs(row.groups),
          selection: selections.get(row.id) || [],
        });
      }
      for (const model of catalog.models) model.fields.sort(byKey((field) => field.name));
    });
  }

  if (has("modules")) {
    await inSection("modules", async () => {
      const rows = await read("ir.module.module", [
        ["state", "in", ["installed", "to upgrade", "to remove"]],
      ]);
      const dependencies = rows.length
        ? await read("ir.module.module.dependency", [
            ["module_id", "in", rows.map((row) => row.id)],
          ])
        : [];
      const dependsOn = new Map();
      dependencies.forEach((row) => {
        const moduleId = many2oneId(row.module_id);
        if (!dependsOn.has(moduleId)) dependsOn.set(moduleId, new Set());
        dependsOn.get(moduleId).add(String(row.name));
      });
      catalog.modules = rows
        .filter((row) => !excluded(String(row.name)))
        .map((row) => ({
          name: String(row.name),
          title: text(row.shortdesc) || String(row.name),
          summary: text(row.summary),
          version: text(row.latest_version),
          diskVersion: text(row.installed_version),
          category: many2oneName(row.category_id),
          application: row.application === true,
          autoInstall: row.auto_install === true,
          license: text(row.license),
          dependencies: [...(dependsOn.get(row.id) || [])].sort(),
          selected: selectedModule(String(row.name)),
        }))
        .filter((module) => module.selected || config.otherModules === "summary")
        .sort(byKey((module) => module.name));
    });
  }

  if (has("access")) {
    await inSection("access", async () => {
      const domain = [["model_id", "in", [...selectedById.keys()]]];
      const entries = [];
      if (catalog.accessModel === "ir.access") {
        for (const row of await read("ir.access", domain)) {
          entries.push({
            modelId: many2oneId(row.model_id),
            name: text(row.name),
            kind: text(row.kind) || "permission",
            groups: await groupRefs(row.group_id ? [many2oneId(row.group_id)] : []),
            operations: text(row.operation) || "",
            domain: text(row.domain),
          });
        }
      } else {
        for (const row of await read("ir.model.access", domain)) {
          entries.push({
            modelId: many2oneId(row.model_id),
            name: text(row.name),
            kind: "permission",
            groups: await groupRefs(row.group_id ? [many2oneId(row.group_id)] : []),
            operations: operationsFromPerms(row),
            domain: null,
          });
        }
        for (const row of await read("ir.rule", domain)) {
          entries.push({
            modelId: many2oneId(row.model_id),
            name: text(row.name),
            kind: "restriction",
            groups: await groupRefs(row.groups),
            operations: operationsFromPerms(row),
            domain: text(row.domain_force),
          });
        }
      }
      for (const { modelId, ...entry } of entries) {
        selectedById.get(modelId)?.access.push(entry);
      }
      for (const model of catalog.models) {
        model.access.sort(
          byKey(
            (entry) => entry.kind,
            (entry) => entry.groups.map((group) => group.key).join(","),
            (entry) => entry.name || "",
            (entry) => entry.operations,
            (entry) => entry.domain || "",
          ),
        );
      }
    });
  }

  if (has("groups")) {
    await inSection("groups", async () => {
      const index = await groupIndex();
      catalog.groups = [...index.values()]
        .map(({ impliedIds, ...group }) => ({
          ...group,
          implies: impliedIds
            .map((id) => index.get(id))
            .filter(Boolean)
            .map((implied) => ({ key: implied.key, name: implied.fullName }))
            .sort(byKey((implied) => implied.key)),
        }))
        .sort(byKey((group) => group.key));
    });
  }

  if (has("menus")) {
    await inSection("menus", async () => {
      const [rows, keys] = await Promise.all([
        read("ir.ui.menu", [], { "ir.ui.menu.full_list": true }),
        xmlids("ir.ui.menu"),
      ]);
      const windowIds = rows
        .map((row) => /^ir\.actions\.act_window,(\d+)$/.exec(String(row.action || "")))
        .filter(Boolean)
        .map((match) => Number(match[1]));
      const windows = new Map(
        (windowIds.length
          ? await read("ir.actions.act_window", [["id", "in", [...new Set(windowIds)]]])
          : []
        ).map((row) => [row.id, row]),
      );
      const children = new Map();
      rows.forEach((row) => {
        const parent = many2oneId(row.parent_id);
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(row);
      });
      const ordered = (list) =>
        (list || []).slice().sort(
          byKey(
            (row) => Number(row.sequence) || 0,
            (row) => String(row.name),
            (row) => row.id,
          ),
        );
      const describeAction = (value) => {
        const match = /^([a-z_.]+),(\d+)$/.exec(String(value || ""));
        if (!match) return null;
        const window = match[1] === "ir.actions.act_window" ? windows.get(Number(match[2])) : null;
        return {
          type: match[1],
          name: window ? text(window.name) : null,
          model: window ? text(window.res_model) : null,
        };
      };
      for (const root of ordered(children.get(null))) {
        const menus = [];
        const walk = async (row, path, depth) => {
          for (const child of ordered(children.get(row.id))) {
            const childPath = [...path, text(child.name) || `Menu ${child.id}`];
            menus.push({
              path: childPath,
              depth,
              action: describeAction(child.action),
              groups: await groupRefs(child[shape.groupsField]),
            });
            await walk(child, childPath, depth + 1);
          }
        };
        await walk(root, [], 1);
        const xmlid = keys.get(root.id) || null;
        catalog.apps.push({
          key: xmlid || `menu-${root.id}`,
          xmlid,
          name: text(root.name) || `Menu ${root.id}`,
          sequence: Number(root.sequence) || 0,
          action: describeAction(root.action),
          groups: await groupRefs(root[shape.groupsField]),
          menus,
        });
      }
    });
  }

  const modelName = (value) => modelById.get(many2oneId(value))?.model || null;
  const selectedByName = new Map(catalog.models.map((model) => [model.model, model]));
  const attach = (model, list, entry) => selectedByName.get(model)?.[list].push(entry);

  if (has("crons")) {
    await inSection("crons", async () => {
      for (const row of await read("ir.cron", [], { active_test: false })) {
        attach(modelName(row.model_id), "crons", {
          name: text(row.cron_name) || `Scheduled job ${row.id}`,
          interval: `${Number(row.interval_number) || 0} ${String(row.interval_type || "")}`.trim(),
          active: row.active === true,
          priority: Number(row.priority) || 0,
        });
      }
      for (const model of catalog.models) model.crons.sort(byKey((cron) => cron.name));
    });
  }

  if (has("reports")) {
    await inSection("reports", async () => {
      for (const row of await read("ir.actions.report", [])) {
        attach(text(row.model), "reports", {
          name: text(row.name) || String(row.report_name),
          reportName: text(row.report_name),
          type: text(row.report_type),
          groups: await groupRefs(row[shape.groupsField]),
        });
      }
      for (const model of catalog.models) {
        model.reports.sort(
          byKey(
            (report) => report.reportName || "",
            (report) => report.name,
          ),
        );
      }
    });
  }

  if (has("serverActions")) {
    await inSection("serverActions", async () => {
      for (const row of await read("ir.actions.server", [["usage", "=", "ir_actions_server"]])) {
        attach(modelName(row.model_id), "serverActions", {
          name: text(row.name) || `Server action ${row.id}`,
          type: text(row.state),
          bound: many2oneId(row.binding_model_id) !== null,
          groups: await groupRefs(row[shape.groupsField]),
        });
      }
      for (const model of catalog.models) {
        model.serverActions.sort(
          byKey(
            (action) => action.name,
            (action) => action.type || "",
          ),
        );
      }
    });
  }

  catalog.modelIndex = catalog.modelIndex.map(({ id, ...model }) => model);
  return catalog;
}

module.exports = {
  CatalogError,
  DEFAULT_SECTIONS,
  BASE_FIELDS,
  SUPPORTED_VERSIONS,
  VERSIONS,
  fieldsFor,
  MODEL_SECTIONS,
  SECTIONS,
  readCatalog,
};
