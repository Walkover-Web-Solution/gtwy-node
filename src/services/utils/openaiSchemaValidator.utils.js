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

const ALLOWED_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

function walkSchema(node, path, errors, defs, anyOfDepth, propCount, visited = new Set()) {
  if (!node || typeof node !== "object") return;

  // Check for disallowed keywords
  for (const key of Object.keys(node)) {
    if (!ALLOWED_KEYWORDS.has(key)) {
      errors.push(`Unsupported keyword '${key}' at '${path}'`);
    }
  }

  // Handle $ref
  if (node.$ref !== undefined) {
    if (typeof node.$ref !== "string" || !node.$ref.startsWith("#/$defs/")) {
      errors.push(`$ref at '${path}' must reference '#/$defs/...'`);
    } else {
      // $ref must not have sibling keywords
      const siblings = Object.keys(node).filter((k) => k !== "$ref");
      if (siblings.length > 0) {
        errors.push(`$ref at '${path}' must not have sibling keywords (found: ${siblings.join(", ")})`);
      }
      const defName = node.$ref.replace("#/$defs/", "");
      if (!defs || !defs[defName]) {
        errors.push(`$ref at '${path}' points to missing definition '#/$defs/${defName}'`);
      } else if (!visited.has(defName)) {
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
  if (node.anyOf !== undefined) {
    if (!Array.isArray(node.anyOf) || node.anyOf.length === 0) {
      errors.push(`anyOf at '${path}' must be a non-empty array`);
    } else if (anyOfDepth + 1 > 5) {
      errors.push(`anyOf/$ref nesting exceeds 5 levels at '${path}'`);
    } else {
      node.anyOf.forEach((branch, i) => {
        walkSchema(branch, `${path}.anyOf[${i}]`, errors, defs, anyOfDepth + 1, propCount, visited);
      });
    }
    return;
  }

  // enum / const leaves don't require 'type'
  const hasEnum = node.enum !== undefined;
  const hasConst = node.const !== undefined;

  if (hasEnum && (!Array.isArray(node.enum) || node.enum.length === 0)) {
    errors.push(`enum at '${path}' must be a non-empty array`);
  }

  // Validate 'type' presence and value
  if (node.type === undefined) {
    if (!hasEnum && !hasConst) {
      errors.push(`Schema at '${path}' must define 'type' (or use $ref/anyOf/enum/const)`);
    }
  } else if (typeof node.type === "string") {
    if (!ALLOWED_TYPES.has(node.type)) {
      errors.push(`Invalid type '${node.type}' at '${path}'`);
    }
  } else if (Array.isArray(node.type)) {
    for (const t of node.type) {
      if (!ALLOWED_TYPES.has(t)) {
        errors.push(`Invalid type '${t}' in type array at '${path}'`);
      }
    }
  } else {
    errors.push(`'type' at '${path}' must be a string or array of strings`);
  }

  if (node.required !== undefined && !Array.isArray(node.required)) {
    errors.push(`'required' at '${path}' must be an array`);
  }

  // Handle object type
  if (node.type === "object") {
    if (node.additionalProperties !== false) {
      errors.push(`Object at '${path}' must have additionalProperties: false`);
    }

    if (!node.properties || typeof node.properties !== "object") {
      errors.push(`Object at '${path}' must define 'properties'`);
    } else {
      const propKeys = Object.keys(node.properties);
      const propKeySet = new Set(propKeys);
      const requiredArr = Array.isArray(node.required) ? node.required : [];
      const required = new Set(requiredArr);

      for (const r of requiredArr) {
        if (!propKeySet.has(r)) {
          errors.push(`Required field '${r}' at '${path}' is not defined in properties`);
        }
      }

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
  if (node.type === "array") {
    if (!node.items || typeof node.items !== "object" || Array.isArray(node.items)) {
      errors.push(`Array at '${path}' must define 'items' as a schema object`);
    } else {
      walkSchema(node.items, `${path}.items`, errors, defs, anyOfDepth, propCount, visited);
    }
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
