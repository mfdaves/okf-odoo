"use strict";

// Checks a value against the small JSON Schema subset the tool schemas use:
// type, enum, properties, required, additionalProperties: false, items,
// prefixItems, min/maxItems, min/maxLength, pattern, minimum/maximum, anyOf.
// Returns the path of the first violation, or null. The path names schema
// properties and array positions only, never a value or an unknown key.

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  return actual === type || (type === "number" && actual === "integer");
}

function violation(schema, value, path = "") {
  if (!schema || typeof schema !== "object") return null;
  if (schema.anyOf) {
    return schema.anyOf.some((branch) => violation(branch, value, path) === null)
      ? null
      : path || "/";
  }
  if (schema.type && !matchesType(value, schema.type)) return path || "/";
  if (schema.enum && !schema.enum.includes(value)) return path || "/";
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) return path || "/";
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return path || "/";
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) return path || "/";
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return path || "/";
    if (schema.maximum !== undefined && value > schema.maximum) return path || "/";
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return path || "/";
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return path || "/";
    for (let index = 0; index < value.length; index += 1) {
      const itemSchema = schema.prefixItems?.[index] ?? schema.items;
      const found = violation(itemSchema, value[index], `${path}/${index}`);
      if (found) return found;
    }
  }
  if (typeOf(value) === "object") {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) return `${path}/${key}`;
    }
    for (const [key, child] of Object.entries(value)) {
      const property = schema.properties?.[key];
      if (!property) {
        // The caller's own key is not echoed.
        if (schema.additionalProperties === false) return `${path}/(unexpected property)`;
        continue;
      }
      const found = violation(property, child, `${path}/${key}`);
      if (found) return found;
    }
  }
  return null;
}

module.exports = { violation };
