"use strict";

// Every string read from Odoo reaches a concept through one of the contexts
// below. Each returns a single line that CommonMark, and GitHub-flavoured
// tables, read back as the same text in that context: it cannot add a link,
// image, autolink, HTML, entity, emphasis, heading, list, quote, fence, table
// column or line break.

const WORD = /[\p{L}\p{N}]/u;
// Controls (C0, DEL, C1 including NEL), the byte order mark and the Unicode
// line and paragraph separators become spaces; runs of spaces collapse.
const BREAKS = /[\p{Cc}\ufeff\u2028\u2029]/gu;

// Normalised plain text: well-formed Unicode on one line, trimmed. Used as is
// in YAML frontmatter, which js-yaml quotes.
function clean(value) {
  return String(value ?? "")
    .toWellFormed()
    .replace(BREAKS, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

// Text in the middle of a line: a paragraph after other words, a heading after
// its marker, a table cell, link text. Backslash-escapes the characters that
// open or close inline constructs, plus `|` for table cells and `#` for heading
// closing sequences. `_` between two letters or digits cannot start emphasis
// and stays as it is, and `&` only needs escaping where it starts an entity.
function inline(value) {
  const text = clean(value);
  return text.replace(/[\\`*_[\]<|~#&]/g, (char, offset) => {
    if (char === "_") {
      return WORD.test(text[offset - 1] || "") && WORD.test(text[offset + 1] || "") ? "_" : "\\_";
    }
    if (char === "&") return /^&#?[0-9A-Za-z]+;/.test(text.slice(offset)) ? "\\&" : "&";
    return `\\${char}`;
  });
}

// Text that starts a line or follows a list marker, where a leading `>`, `-`,
// `+`, `=` or `1.` would open a quote, list, break or setext heading. An empty
// value becomes a dash, so the line or list item keeps its content.
function lineStart(value) {
  const text = inline(value)
    .replace(/^[>+=-]/, "\\$&")
    .replace(/^(\d{1,9})([.)])/, "$1\\$2");
  return text || "—";
}

// A code span whose delimiter is longer than any backtick run in the value,
// padded when the value starts or ends with a backtick. Inside a table cell a
// `|` is escaped, which GitHub-flavoured tables undo before parsing the span.
function codeSpan(value, { table = false } = {}) {
  let text = clean(value);
  if (!text) return "—";
  if (table) text = text.replace(/\|/g, "\\|");
  const longest = Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = /^`|`$/.test(text) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

// A table cell, with a dash for an empty value.
function cell(value) {
  return inline(value) || "—";
}

// A row of a GitHub-flavoured table. The leading pipe keeps the first cell
// out of line-start position.
function row(cells) {
  return `| ${cells.join(" | ")} |`;
}

module.exports = {
  cell,
  clean,
  codeSpan,
  inline,
  lineStart,
  linkText: inline,
  row,
};
