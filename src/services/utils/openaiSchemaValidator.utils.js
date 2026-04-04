const ALLOWED_KEYWORDS = new Set([
  "type",
  "properties",
  "items",
  "enum",
  "const",
  "anyOf",
  "$ref",
  "$defs",
  "required",
  "additionalProperties",
  "description",
  "title",
  "default",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "pattern",
  "format"
]);

function walkSchema(node, path, errors, defs, anyOfDepth, propCount, visited = new Set()) {
  if (!node || typeof node !== "object") return;

  // Check for disallowed keywords
  for (const key of Object.keys(node)) {
    if (!ALLOWED_KEYWORDS.has(key)) {
      errors.push(`Unsupported keyword '${key}' at '${path}'`);
    }
  }

  // Handle $ref
  if (node.$ref) {
    if (typeof node.$ref !== "string" || !node.$ref.startsWith("#/$defs/")) {
      errors.push(`$ref at '${path}' must reference '#/$defs/...'`);
    } else {
      const defName = node.$ref.replace("#/$defs/", "");
      if (defs && defs[defName]) {
        if (visited.has(defName)) {
          return;
        }
        if (anyOfDepth + 1 > 5) {
          errors.push(`anyOf/$ref nesting exceeds 5 levels at '${path}'`);
        } else {
          visited.add(defName);
          walkSchema(defs[defName], `$defs.${defName}`, errors, defs, anyOfDepth + 1, propCount, visited);
        }
      }
    }
    return;
  }

  // Handle anyOf
  if (node.anyOf) {
    if (anyOfDepth + 1 > 5) {
      errors.push(`anyOf/$ref nesting exceeds 5 levels at '${path}'`);
    } else {
      node.anyOf.forEach((branch, i) => {
        walkSchema(branch, `${path}.anyOf[${i}]`, errors, defs, anyOfDepth + 1, propCount, visited);
      });
    }
  }

  // Handle object type
  if (node.type === "object") {
    if (node.additionalProperties !== false) {
      errors.push(`Object at '${path}' must have additionalProperties: false`);
    }

    if (node.properties) {
      const propKeys = Object.keys(node.properties);
      const required = new Set(node.required || []);

      for (const key of propKeys) {
        propCount.count++;
        if (!required.has(key)) {
          errors.push(`Property '${key}' at '${path}' is missing from required array`);
        }
        walkSchema(node.properties[key], `${path}.${key}`, errors, defs, anyOfDepth, propCount, visited);
      }
    }
  }

  // Handle array type
  if (node.type === "array" && node.items) {
    walkSchema(node.items, `${path}.items`, errors, defs, anyOfDepth, propCount, visited);
  }
}

export function validateOpenAISchema(jsonSchemaObj) {
  const errors = [];

  if (!jsonSchemaObj || typeof jsonSchemaObj !== "object" || Object.keys(jsonSchemaObj).length === 0) {
    return { isValid: false, errors: ["json_schema must be a valid object"] };
  }

  // Check name
  if (!jsonSchemaObj.name || typeof jsonSchemaObj.name !== "string") {
    errors.push("json_schema.name is required and must be a non-empty string");
  }

  // Check strict
  if (jsonSchemaObj.strict !== true) {
    errors.push("json_schema.strict must be true for structured outputs");
  }

  const schema = jsonSchemaObj.schema;
  if (!schema || typeof schema !== "object") {
    errors.push("json_schema.schema is required and must be an object");
    return { isValid: false, errors };
  }

  // Root must be type: "object"
  if (schema.type !== "object") {
    errors.push("Root schema must have type: 'object'");
  }

  const propCount = { count: 0 };
  walkSchema(schema, "root", errors, schema.$defs || {}, 0, propCount);

  if (propCount.count > 100) {
    errors.push(`Schema exceeds 100 total properties (found ${propCount.count})`);
  }

  return { isValid: errors.length === 0, errors };
}
