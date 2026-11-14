"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");
const packageJson = require("../package.json");

test("the package keeps its runtime to js-yaml and built-in fetch", () => {
  assert.equal(packageJson.name, "@mfdaves/okf-odoo");
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.engines.node, ">=22");
  assert.deepEqual(Object.keys(packageJson.dependencies), ["js-yaml"]);
  assert.equal(packageJson.bin, undefined);
  assert.deepEqual(packageJson.files, ["src", "okf", "README.md", "LICENSE"]);
});

test("the reference bundle declares OKF 0.2 in its root index", () => {
  const text = fs.readFileSync(path.join(__dirname, "../okf/okf-odoo/index.md"), "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "index.md must start with frontmatter");
  assert.deepEqual(yaml.load(match[1]), { okf_version: "0.2" });
});
