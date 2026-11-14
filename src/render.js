"use strict";

// Renders a normalised catalog as OKF v0.2 concepts. Output depends only on
// the catalog and the options: ordering and paths are stable, and the only
// time value is generated.at, which the host ignores when comparing runs.

const crypto = require("node:crypto");
const path = require("node:path");
const yaml = require("js-yaml");
const packageJson = require("../package.json");
const { cell, clean, codeSpan, inline, lineStart, linkText, row } = require("./markdown");

const RELATION_TYPES = Object.freeze([
  "defined_in",
  "extended_by",
  "references",
  "implies",
  "opens",
  "depends_on",
]);
const OPERATIONS = { c: "create", r: "read", u: "update", d: "delete" };
const IDENTIFIER = /^[A-Za-z0-9_.-]+$/;

// index.md and log.md are reserved by OKF in every directory of a bundle.
const RESERVED_BASENAMES = new Set(["index", "log"]);

// A path segment that names one file on every file system and is never a
// reserved basename. Only a lowercase name made of safe characters is used as
// is; anything else, including a name that differs from another only by case
// on macOS or Windows, gets a short hash of the original appended.
function safeSegment(value) {
  const original = String(value).toWellFormed().normalize("NFC");
  if (
    /^[a-z0-9][a-z0-9_.-]*$/.test(original) &&
    !original.endsWith(".") &&
    !RESERVED_BASENAMES.has(original)
  ) {
    return original;
  }
  const base = original.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "") || "object";
  const digest = crypto.createHash("sha256").update(original).digest("hex").slice(0, 8);
  return `${base}--${digest}`;
}

function conceptMarkdown(frontmatter, body) {
  const header = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true, sortKeys: false });
  return `---\n${header.trimEnd()}\n---\n\n${String(body).trim()}\n`.toWellFormed();
}

function table(header, rows, empty) {
  if (!rows.length) return empty;
  return [row(header), row(header.map(() => "---")), ...rows.map(row)].join("\n");
}

function list(items, empty) {
  return items.length ? items.join("\n") : empty;
}

const files = {
  module: (name) => `modules/${safeSegment(name)}.md`,
  model: (name) => `models/${safeSegment(name)}.md`,
  group: (key) => `groups/${safeSegment(key)}.md`,
  app: (key) => `apps/${safeSegment(key)}.md`,
};

function operations(value) {
  const words = [...String(value || "")].map((letter) => OPERATIONS[letter]).filter(Boolean);
  return words.length ? words.join(", ") : "none";
}

class Renderer {
  constructor(catalog, options) {
    this.catalog = catalog;
    this.options = options;
    this.sections = new Set(catalog.sections || []);
    this.modules = new Map((catalog.modules || []).map((module) => [module.name, module]));
    this.models = new Map((catalog.models || []).map((model) => [model.model, model]));
    this.groups = new Map((catalog.groups || []).map((group) => [group.key, group]));
  }

  uri(file) {
    return `okf://${this.options.bundle}/${file.slice(0, -3)}`;
  }

  resource(...parts) {
    const encode = (part) => encodeURIComponent(String(part).toWellFormed());
    return `odoo://${[this.options.source, ...parts].map(encode).join("/")}`;
  }

  sources(...models) {
    return models.map((model) => ({
      resource: this.resource(model),
      title: `${this.options.source} ${model}`,
    }));
  }

  generated() {
    const generated = { by: `okf-odoo/${this.options.producerVersion}` };
    if (this.options.generatedAt) generated.at = this.options.generatedAt;
    return generated;
  }

  href(from, to) {
    return path.posix.relative(path.posix.dirname(from), to);
  }

  // References are a link when the target is rendered, else plain text that is
  // safe both at the start of a list item and inside a table cell.
  moduleRef(from, name, table = false) {
    return this.modules.has(name)
      ? `[${linkText(name)}](${this.href(from, files.module(name))})`
      : codeSpan(name, { table });
  }

  modelRef(from, name, table = false) {
    return this.models.has(name)
      ? `[${linkText(name)}](${this.href(from, files.model(name))})`
      : codeSpan(name, { table });
  }

  groupRef(from, group) {
    return this.groups.has(group.key)
      ? `[${linkText(group.name)}](${this.href(from, files.group(group.key))})`
      : lineStart(group.name);
  }

  groupRefs(from, groups, empty) {
    return groups.length ? groups.map((group) => this.groupRef(from, group)).join(", ") : empty;
  }

  concept(file, frontmatter, body) {
    const relations = (frontmatter.relations || []).filter(
      (relation, index, all) =>
        all.findIndex(
          (other) => other.type === relation.type && other.target === relation.target,
        ) === index,
    );
    const ordered = {
      id: this.uri(file),
      type: frontmatter.type,
      title: clean(frontmatter.title),
      description: clean(frontmatter.description),
      resource: frontmatter.resource,
      sources: frontmatter.sources,
      generated: this.generated(),
      tags: frontmatter.tags,
    };
    if (relations.length) ordered.relations = relations;
    return [file, conceptMarkdown(ordered, body)];
  }

  moduleConcept(module) {
    const file = files.module(module.name);
    const index = this.catalog.modelIndex || [];
    const defined = index.filter((model) => model.definedIn === module.name);
    const extended = index.filter(
      (model) => model.definedIn !== module.name && model.modules.includes(module.name),
    );
    const modelItem = (model) => `- ${this.modelRef(file, model.model)} — ${cell(model.name)}`;
    const facts = [
      `- Technical name: ${codeSpan(module.name)}`,
      `- Installed version: ${codeSpan(module.version)}`,
      module.diskVersion && module.diskVersion !== module.version
        ? `- Version on disk: ${codeSpan(module.diskVersion)} (differs from the installed version)`
        : null,
      module.category ? `- Category: ${inline(module.category)}` : null,
      `- Application: ${module.application ? "yes" : "no"}`,
      `- Installed automatically with its dependencies: ${module.autoInstall ? "yes" : "no"}`,
      module.license ? `- License: ${inline(module.license)}` : null,
      `- Documented in full: ${module.selected ? "yes" : "no, summary only"}`,
    ].filter(Boolean);
    const body = [
      `# ${inline(module.title)}`,
      "",
      clean(module.summary) ? lineStart(module.summary) : `Odoo module ${codeSpan(module.name)}.`,
      "",
      ...facts,
      "",
      "## Dependencies",
      "",
      list(
        module.dependencies.map((name) => `- ${this.moduleRef(file, name)}`),
        "No dependencies.",
      ),
    ];
    if (this.sections.has("models")) {
      body.push(
        "",
        "## Models defined",
        "",
        list(defined.map(modelItem), "None."),
        "",
        "## Models extended",
        "",
        list(extended.map(modelItem), "None."),
      );
    }
    return this.concept(
      file,
      {
        type: "Odoo Module",
        title: `${clean(module.title)} (${clean(module.name)})`,
        description: module.summary || `Odoo module ${module.name} (${module.title}).`,
        resource: this.resource("ir.module.module", module.name),
        sources: this.sources("ir.module.module", "ir.module.module.dependency"),
        tags: ["odoo", "module", module.application ? "application" : null].filter(Boolean),
        relations: module.dependencies
          .filter((name) => this.modules.has(name))
          .map((name) => ({ type: "depends_on", target: this.uri(files.module(name)) })),
      },
      body.join("\n"),
    );
  }

  fieldFlags(file, field) {
    return [
      field.required ? "required" : null,
      field.readonly ? "read-only" : null,
      field.stored ? "stored" : "not stored",
      field.index
        ? field.index === "indexed"
          ? "indexed"
          : `indexed (${inline(field.index)})`
        : null,
      field.translate
        ? field.translate === "translated"
          ? "translated"
          : `translated (${inline(field.translate)})`
        : null,
      field.companyDependent ? "company-dependent" : null,
      field.related ? `related to ${codeSpan(field.related, { table: true })}` : null,
      field.onDelete ? `on delete ${inline(field.onDelete)}` : null,
      field.custom ? "custom" : null,
      field.groups.length ? `groups: ${this.groupRefs(file, field.groups)}` : null,
    ]
      .filter(Boolean)
      .join(", ");
  }

  modelConcept(model) {
    const file = files.model(model.model);
    const relationTargets = [
      ...new Set(
        model.fields
          .map((field) => field.relation)
          .filter((name) => name && name !== model.model && this.models.has(name)),
      ),
    ].sort();
    const fieldRows = model.fields.map((field) => [
      codeSpan(field.name, { table: true }),
      cell(field.label),
      codeSpan(field.type, { table: true }),
      field.relation
        ? `${this.modelRef(file, field.relation, true)}${field.relationField ? ` (${codeSpan(field.relationField, { table: true })})` : ""}`
        : "—",
      this.fieldFlags(file, field) || "—",
      field.modules.map((name) => this.moduleRef(file, name, true)).join(", ") || "—",
      cell(field.help),
    ]);
    const selections = model.fields.filter((field) => field.selection.length);
    const extenders = model.modules.filter((name) => name !== model.definedIn);
    const kind = {
      model: "model",
      transient: "transient model (wizard)",
      abstract: "abstract model",
    };
    const body = [
      `# ${inline(model.name)} (${codeSpan(model.model)})`,
      "",
      `- Kind: ${kind[model.kind] || `model or abstract model (Odoo ${this.catalog.odooVersion} does not record which)`}`,
      `- Defined in: ${model.definedIn ? this.moduleRef(file, model.definedIn) : "no module (created in the database)"}`,
      `- Extended by: ${extenders.map((name) => this.moduleRef(file, name)).join(", ") || "no other module"}`,
      model.custom ? "- Custom model created in the database" : null,
      "",
      "## Fields",
      "",
      this.catalog.fieldGroups === false
        ? `Field groups are not available on Odoo ${this.catalog.odooVersion}: it does not record which groups may access a field defined in code, so this table cannot show field-level restrictions.\n`
        : null,
      table(
        ["Field", "Label", "Type", "Relation", "Properties", "Modules", "Help"],
        fieldRows,
        "No fields were read.",
      ),
    ].filter((line) => line !== null);
    if (selections.length) {
      body.push("", "## Selection values", "");
      for (const field of selections) {
        body.push(
          `### ${codeSpan(field.name)}`,
          "",
          ...field.selection.map((entry) => `- ${codeSpan(entry.value)} — ${cell(entry.label)}`),
          "",
        );
      }
    }
    if (this.sections.has("access")) {
      body.push(
        "",
        "## Access",
        "",
        table(
          ["Kind", "Groups", "Operations", "Domain", "Name"],
          model.access.map((entry) => [
            cell(entry.kind),
            this.groupRefs(
              file,
              entry.groups,
              entry.kind === "restriction" ? "everyone" : "all users",
            ),
            operations(entry.operations),
            codeSpan(entry.domain, { table: true }),
            cell(entry.name),
          ]),
          "No access entries.",
        ),
      );
    }
    if (this.sections.has("crons")) {
      body.push(
        "",
        "## Scheduled jobs",
        "",
        table(
          ["Name", "Interval", "Active", "Priority"],
          model.crons.map((cron) => [
            cell(cron.name),
            cell(cron.interval),
            cron.active ? "yes" : "no",
            String(cron.priority),
          ]),
          "No scheduled jobs.",
        ),
      );
    }
    if (this.sections.has("reports")) {
      body.push(
        "",
        "## Reports",
        "",
        table(
          ["Name", "Report", "Type", "Groups"],
          model.reports.map((report) => [
            cell(report.name),
            codeSpan(report.reportName, { table: true }),
            codeSpan(report.type, { table: true }),
            this.groupRefs(file, report.groups, "—"),
          ]),
          "No reports.",
        ),
      );
    }
    if (this.sections.has("serverActions")) {
      body.push(
        "",
        "## Server actions",
        "",
        table(
          ["Name", "Type", "In the action menu", "Groups"],
          model.serverActions.map((action) => [
            cell(action.name),
            codeSpan(action.type, { table: true }),
            action.bound ? "yes" : "no",
            this.groupRefs(file, action.groups, "—"),
          ]),
          "No server actions.",
        ),
      );
    }
    const readFrom = ["ir.model", "ir.model.fields"];
    if (this.sections.has("access")) {
      readFrom.push(
        ...(this.catalog.accessModel === "ir.access"
          ? ["ir.access"]
          : ["ir.model.access", "ir.rule"]),
      );
    }
    if (this.sections.has("crons")) readFrom.push("ir.cron");
    if (this.sections.has("reports")) readFrom.push("ir.actions.report");
    if (this.sections.has("serverActions")) readFrom.push("ir.actions.server");
    const relations = [];
    if (model.definedIn && this.modules.has(model.definedIn)) {
      relations.push({ type: "defined_in", target: this.uri(files.module(model.definedIn)) });
    }
    for (const name of extenders.filter((module) => this.modules.has(module))) {
      relations.push({ type: "extended_by", target: this.uri(files.module(name)) });
    }
    for (const name of relationTargets) {
      relations.push({ type: "references", target: this.uri(files.model(name)) });
    }
    return this.concept(
      file,
      {
        type: "Odoo Model",
        title: model.model,
        description: `Odoo ${kind[model.kind] || "model"} ${model.model} (${model.name})${model.definedIn ? ` defined in ${model.definedIn}` : ""}.`,
        resource: this.resource(model.model),
        sources: this.sources(...readFrom),
        tags: [
          "odoo",
          "model",
          model.kind === "model" ? null : model.kind,
          clean(model.definedIn),
        ].filter(Boolean),
        relations,
      },
      body.join("\n"),
    );
  }

  groupConcept(group) {
    const file = files.group(group.key);
    const impliedBy = (this.catalog.groups || []).filter((other) =>
      other.implies.some((implied) => implied.key === group.key),
    );
    const body = [
      `# ${inline(group.fullName)}`,
      "",
      clean(group.comment)
        ? lineStart(group.comment)
        : `Odoo access group ${inline(group.fullName)}.`,
      "",
      group.xmlid ? `- XML id: ${codeSpan(group.xmlid)}` : "- No XML id (created in the database)",
      group.privilege
        ? `- ${this.catalog.odooVersion === "18" ? "Application" : "Privilege"}: ${inline(group.privilege)}`
        : null,
      `- Portal or public group: ${group.share ? "yes" : "no"}`,
      "",
      "## Implies",
      "",
      list(
        group.implies.map((implied) => `- ${this.groupRef(file, implied)}`),
        "No implied groups.",
      ),
      "",
      "## Implied by",
      "",
      list(
        impliedBy.map(
          (other) => `- ${this.groupRef(file, { key: other.key, name: other.fullName })}`,
        ),
        "No group implies this one.",
      ),
    ].filter((line) => line !== null);
    if (this.sections.has("access")) {
      const granted = (this.catalog.models || []).flatMap((model) =>
        model.access
          .filter((entry) => entry.groups.some((ref) => ref.key === group.key))
          .map((entry) => [
            this.modelRef(file, model.model, true),
            cell(entry.kind),
            operations(entry.operations),
            codeSpan(entry.domain, { table: true }),
          ]),
      );
      body.push(
        "",
        "## Access on documented models",
        "",
        table(["Model", "Kind", "Operations", "Domain"], granted, "None."),
      );
    }
    return this.concept(
      file,
      {
        type: "Odoo Group",
        title: group.fullName,
        description: group.comment || `Odoo access group ${group.fullName}.`,
        resource: this.resource("res.groups", group.key),
        sources: this.sources("res.groups", "ir.model.data"),
        tags: ["odoo", "group", group.share ? "portal" : null].filter(Boolean),
        relations: group.implies
          .filter((implied) => this.groups.has(implied.key))
          .map((implied) => ({ type: "implies", target: this.uri(files.group(implied.key)) })),
      },
      body.join("\n"),
    );
  }

  actionText(file, action) {
    if (!action) return "";
    if (action.type === "ir.actions.act_window" && action.model) {
      return ` → ${this.modelRef(file, action.model)}`;
    }
    return ` (${codeSpan(action.type)})`;
  }

  appConcept(app) {
    const file = files.app(app.key);
    const items = app.menus.map((menu) => {
      const indent = "  ".repeat(menu.depth - 1);
      const groups = menu.groups.length ? ` — groups: ${this.groupRefs(file, menu.groups)}` : "";
      return `${indent}- ${lineStart(menu.path[menu.path.length - 1])}${this.actionText(file, menu.action)}${groups}`;
    });
    const opened = [
      ...new Set(
        [app, ...app.menus]
          .map((menu) => menu.action)
          .filter((action) => action?.model && this.models.has(action.model))
          .map((action) => action.model),
      ),
    ].sort();
    const body = [
      `# ${inline(app.name)}`,
      "",
      `Top-level Odoo menu ${cell(app.name)}${this.actionText(file, app.action)}.`,
      "",
      app.xmlid ? `- XML id: ${codeSpan(app.xmlid)}` : "- No XML id (created in the database)",
      `- Visible to: ${this.groupRefs(file, app.groups, "every user with access to the menus below")}`,
      "",
      "## Menus",
      "",
      list(items, "No submenus."),
    ];
    return this.concept(
      file,
      {
        type: "Odoo Application",
        title: app.name,
        description: `Odoo top-level menu ${app.name} with ${app.menus.length} submenus.`,
        resource: this.resource("ir.ui.menu", app.key),
        sources: this.sources("ir.ui.menu", "ir.actions.act_window"),
        tags: ["odoo", "application", "menu"],
        relations: opened.map((name) => ({ type: "opens", target: this.uri(files.model(name)) })),
      },
      body.join("\n"),
    );
  }

  index() {
    const catalog = this.catalog;
    const block = (title, items) => ["", `## ${title}`, "", list(items, "None.")];
    const body = [`# ${inline(this.options.source)} Odoo catalog`];
    if (this.sections.has("menus")) {
      body.push(
        ...block(
          "Applications",
          catalog.apps.map((app) => `- [${linkText(app.name)}](${files.app(app.key)})`),
        ),
      );
    }
    if (this.sections.has("modules")) {
      body.push(
        ...block(
          "Modules",
          catalog.modules.map(
            (module) =>
              `- [${linkText(module.name)}](${files.module(module.name)}) — ${cell(module.title)}`,
          ),
        ),
      );
    }
    if (this.sections.has("models")) {
      body.push(
        ...block(
          "Models",
          catalog.models.map(
            (model) =>
              `- [${linkText(model.model)}](${files.model(model.model)}) — ${cell(model.name)}`,
          ),
        ),
      );
    }
    if (this.sections.has("groups")) {
      body.push(
        ...block(
          "Groups",
          catalog.groups.map(
            (group) => `- [${linkText(group.fullName)}](${files.group(group.key)})`,
          ),
        ),
      );
    }
    return ["index.md", conceptMarkdown({ okf_version: "0.2" }, body.join("\n"))];
  }
}

function normalizeGeneratedAt(value) {
  if (value === undefined || value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("generatedAt must be a valid ISO datetime.");
  return date.toISOString();
}

function buildBundle(catalog, options = {}) {
  if (!catalog || !Array.isArray(catalog.models) || !Array.isArray(catalog.sections)) {
    throw new TypeError("A normalised Odoo catalog is required.");
  }
  const source = String(options.source || "odoo").trim();
  const bundle = String(options.bundle || source).trim();
  if (!IDENTIFIER.test(source) || !IDENTIFIER.test(bundle)) {
    throw new Error(
      "Source and bundle identifiers may contain only letters, numbers, dots, underscores, and hyphens.",
    );
  }
  const renderer = new Renderer(catalog, {
    source,
    bundle,
    generatedAt: normalizeGeneratedAt(options.generatedAt),
    producerVersion: String(options.producerVersion || packageJson.version),
  });
  const entries = [
    renderer.index(),
    ...(catalog.modules || []).map((module) => renderer.moduleConcept(module)),
    ...catalog.models.map((model) => renderer.modelConcept(model)),
    ...(catalog.groups || []).map((group) => renderer.groupConcept(group)),
    ...(catalog.apps || []).map((app) => renderer.appConcept(app)),
  ];
  const result = new Map();
  const folded = new Set();
  for (const [file, content] of entries) {
    // Compared without case: macOS and Windows would write both to one file.
    const key = file.toLowerCase();
    if (folded.has(key)) throw new Error(`Two concepts map to the same path: ${file}`);
    folded.add(key);
    result.set(file, content);
  }
  return result;
}

module.exports = {
  RELATION_TYPES,
  buildBundle,
  conceptMarkdown,
  normalizeGeneratedAt,
  safeSegment,
};
