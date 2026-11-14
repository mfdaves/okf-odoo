"use strict";

// Text from Odoo is untrusted. Every escaping context is checked against a
// hostile corpus with okf-mcp's own CommonMark parser: the text reads back
// unchanged and adds no node a plain word would not, and a catalog whose every
// string is hostile renders to pages with the same structure as a plain one
// and validates.

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { cell, clean, codeSpan, inline, lineStart, linkText, row } = require("../src/markdown");
const { buildBundle } = require("../src/render");
const { MCP_ROOT, siblingAvailable, validateBundlesWithOkfMcp } = require("./support/okf-mcp");

const skip = siblingAvailable() ? false : "requires the sibling ../okf-mcp checkout";

const HOSTILE = [
  "[t](x.md)",
  "[t][r]\n\n[r]: x.md",
  "[r]: x.md",
  "![i](x.png)",
  "<http://evil.example/x>",
  "<mail@example.com>",
  "https://example.com/[x](y.md)",
  "www.example.com",
  "<b>bold</b>",
  "<!-- comment -->",
  "<div>",
  "``` fenced",
  "```",
  "~~~ tilde",
  "# Heading",
  "## Implies",
  "Title #",
  "- item",
  "+ item",
  "* item",
  "1. item",
  "2) item",
  "12. Twelve",
  "> quote",
  "---",
  "***",
  "___",
  "===",
  "Setext\n===",
  "Setext\n---",
  "*em* **strong** _u_ __uu__",
  "a_b_c snake_case _lead trail_",
  "~~strike~~",
  "trailing \\",
  "\\",
  "\\[x\\]",
  "pipe | cell",
  "||",
  "line1\nline2",
  "line1\r\nline2",
  "lone\rCR",
  "nel\u0085next",
  "ls\u2028ps\u2029x",
  "\ufeffbom",
  "lone \ud800 surrogate",
  "low \udc00 only",
  "tab\tsep",
  "`tick` ``two`` ```three```",
  "`",
  "``",
  "&amp; &#123; &#x41; &copy;",
  "R&D",
  "    indented code",
  "x\u0000nul\u0007bell\u001b[0m",
  "del\u007f",
  " ",
  "",
  "a  b",
];

function mcp() {
  return {
    ...require(path.join(MCP_ROOT, "src/markdown")),
    ...require(path.join(MCP_ROOT, "src/parser")),
  };
}

function plainText(node) {
  let output = "";
  const walker = node.walker();
  let event = walker.next();
  while (event) {
    if (event.entering && ["text", "code"].includes(event.node.type)) {
      output += event.node.literal || "";
    }
    event = walker.next();
  }
  return output;
}

// The node types of a parsed body other than the text they carry, the heading
// levels in order, and the H2 titles (always the renderer's own words).
function structure(body) {
  const { markdownStructure, extractMarkdownLinks } = mcp();
  const parsed = markdownStructure(body);
  const counts = {};
  const walker = parsed.tree.walker();
  let event = walker.next();
  while (event) {
    if (event.entering && !["text", "code"].includes(event.node.type)) {
      counts[event.node.type] = (counts[event.node.type] || 0) + 1;
    }
    event = walker.next();
  }
  return {
    counts,
    headings: parsed.headings.map((heading) => heading.level),
    sections: parsed.headings.filter((heading) => heading.level === 2).map((h) => h.text),
    links: extractMarkdownLinks(body).length,
  };
}

function firstOfType(body, type) {
  const walker = mcp().markdownStructure(body).tree.walker();
  let event = walker.next();
  while (event) {
    if (event.entering && event.node.type === type) return event.node;
    event = walker.next();
  }
  return null;
}

// A GitHub-flavoured row splits on every pipe without a backslash before it.
function columns(line) {
  return line.split(/(?<!\\)\|/).length - 2;
}

test("every context reads back as the same text and adds no structure", { skip }, () => {
  const templates = {
    inline: (value) => `# Title\n\nBefore ${inline(value)} after.\n\n## Next\n\n- [own](own.md)`,
    lineStart: (value) => `# Title\n\n${lineStart(value)}\n\n- ${lineStart(value)}\n\n## Next`,
    codeSpan: (value) => `# Title\n\n- Value: ${codeSpan(value)}\n\n## Next`,
    linkText: (value) => `# Title\n\n- [${linkText(value)}](own.md)\n\n## Next`,
    heading: (value) => `# Title\n\n## ${inline(value)}\n\nText.`,
    table: (value) =>
      `# Title\n\n${row(["A", "B", "C"])}\n${row(["---", "---", "---"])}\n${row([
        cell(value),
        codeSpan(value, { table: true }),
        `[${linkText(value)}](own.md)`,
      ])}\n\n## Next`,
  };
  for (const [context, template] of Object.entries(templates)) {
    // The heading template's H2 is the value itself, so titles are not compared.
    const shape = (body) => {
      const { sections, ...rest } = structure(body);
      return context === "heading" ? rest : { sections, ...rest };
    };
    const expected = shape(template("plain"));
    for (const value of HOSTILE) {
      const body = template(value);
      const label = `${context} ${JSON.stringify(value)}`;
      assert.deepEqual(shape(body), expected, label);
      assert.equal(body.split("\n").length, template("plain").split("\n").length, label);
    }
  }
  for (const value of HOSTILE) {
    const text = clean(value);
    const label = JSON.stringify(value);
    if (text) {
      assert.equal(
        plainText(firstOfType(`x ${inline(value)} y`, "paragraph")),
        `x ${text} y`,
        label,
      );
      assert.equal(plainText(firstOfType(lineStart(value), "paragraph")), text, label);
      assert.equal(plainText(firstOfType(`- ${lineStart(value)}`, "item")), text, label);
      assert.equal(firstOfType(`- v ${codeSpan(value)}`, "code").literal, text, label);
      assert.equal(plainText(firstOfType(`[${linkText(value)}](x.md)`, "link")), text, label);
      assert.equal(plainText(firstOfType(`## ${inline(value)}`, "heading")), text, label);
    }
    const table = row([cell(value), codeSpan(value, { table: true }), "end"]);
    assert.equal(columns(table), 3, `table ${label}`);
    assert.ok(!/[\r\n\u2028\u2029\u0085]/.test(inline(value) + codeSpan(value)), label);
    assert.equal(clean(value), clean(value).toWellFormed(), label);
  }
});

function catalogWith(text) {
  const group = { key: `g.${text}`, name: text };
  const other = { key: `h.${text}`, name: text };
  return {
    sections: [
      "modules",
      "models",
      "access",
      "groups",
      "menus",
      "crons",
      "reports",
      "serverActions",
    ],
    accessModel: "ir.access",
    modules: [
      {
        name: `m${text}`,
        title: text,
        summary: text,
        version: text,
        diskVersion: `${text}2`,
        category: text,
        application: true,
        autoInstall: false,
        license: text,
        dependencies: [`d${text}`],
        selected: true,
      },
    ],
    modelIndex: [
      {
        model: `o${text}`,
        name: text,
        kind: "model",
        custom: false,
        modules: [`m${text}`],
        definedIn: `m${text}`,
      },
    ],
    models: [
      {
        model: `o${text}`,
        name: text,
        kind: "model",
        custom: false,
        modules: [`m${text}`, `n${text}`],
        definedIn: `m${text}`,
        fields: [
          {
            name: text,
            label: text,
            type: text,
            relation: `r${text}`,
            relationField: text,
            required: true,
            readonly: false,
            stored: true,
            index: text,
            translate: text,
            related: text,
            help: text,
            custom: false,
            companyDependent: false,
            onDelete: text,
            modules: [`m${text}`, `n${text}`],
            groups: [group, other],
            selection: [{ value: text, label: text }],
          },
        ],
        access: [
          { name: text, kind: text, groups: [group, other], operations: "crud", domain: text },
        ],
        crons: [{ name: text, interval: text, active: true, priority: 1 }],
        reports: [{ name: text, reportName: text, type: text, groups: [group] }],
        serverActions: [{ name: text, type: text, bound: true, groups: [other] }],
      },
    ],
    groups: [
      {
        key: group.key,
        xmlid: group.key,
        name: text,
        fullName: text,
        privilege: text,
        comment: text,
        share: false,
        implies: [other],
      },
    ],
    apps: [
      {
        key: `a.${text}`,
        xmlid: `a.${text}`,
        name: text,
        sequence: 1,
        action: { type: text, name: text, model: null },
        groups: [group, other],
        menus: [
          {
            path: [text],
            depth: 1,
            action: { type: "ir.actions.act_window", name: text, model: `o${text}` },
            groups: [group],
          },
          {
            path: [text, text],
            depth: 2,
            action: { type: text, name: null, model: null },
            groups: [],
          },
        ],
      },
    ],
  };
}

test("a catalog of hostile text renders to the structure of a plain one and validates", {
  skip,
}, () => {
  const { extractMarkdownLinks } = mcp();
  const body = (content) => content.replace(/^---\n[\s\S]*?\n---\n/, "");
  const render = (text, bundle) =>
    buildBundle(catalogWith(text), { source: "erp", bundle, generatedAt: "2026-11-14T10:00:00Z" });
  const plain = [...render("plain", "erp").values()].map((content) => structure(body(content)));
  const bundles = new Map();
  HOSTILE.forEach((value, index) => {
    const bundle = `hostile${index}`;
    const files = render(value, bundle);
    bundles.set(bundle, files);
    const label = JSON.stringify(value);
    assert.equal(files.size, plain.length, label);
    [...files.entries()].forEach(([file, content], position) => {
      // Optional facts (category, license) are left out when a value is empty.
      if (clean(value)) {
        assert.deepEqual(structure(body(content)), plain[position], `${label} ${file}`);
      }
      for (const link of extractMarkdownLinks(body(content))) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), link.href));
        assert.ok(files.has(target), `${label} ${file} links to ${link.href}`);
      }
    });
  });
  const outcome = validateBundlesWithOkfMcp(bundles);
  assert.equal(outcome.status, 0, JSON.stringify(outcome.result?.diagnostics?.slice(0, 5)));
  assert.equal(outcome.result.valid, true);
  assert.deepEqual(outcome.result.warnings, []);
});
