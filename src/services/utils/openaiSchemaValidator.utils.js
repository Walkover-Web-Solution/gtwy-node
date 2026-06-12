// Validates a json_schema object against OpenAI structured outputs rules:
// https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas
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
  // strings
  "pattern",
  "format",
  // numbers
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  // arrays
  "minItems",
  "maxItems"
]);

// Fix hints for commonly used keywords that OpenAI structured outputs does not support
const UNSUPPORTED_KEYWORD_HINTS = {
  minLength: 'string length limits are not supported — use \'pattern\' (regex) instead, e.g. "pattern": "^.{1,50}$"',
  maxLength: 'string length limits are not supported — use \'pattern\' (regex) instead, e.g. "pattern": "^.{1,50}$"',
  default: '\'default\' is not supported — all fields are always required; for optional fields use "type": ["<type>", "null"]',
  oneOf: "'oneOf' is not supported — use 'anyOf' instead",
  allOf: "'allOf' composition is not supported — merge the schemas into a single object",
  not: "'not' composition is not supported",
  if: "'if/then/else' composition is not supported",
  then: "'if/then/else' composition is not supported",
  else: "'if/then/else' composition is not supported",
  dependentRequired: "'dependentRequired' is not supported",
  dependentSchemas: "'dependentSchemas' is not supported",
  patternProperties: "'patternProperties' is not supported — define each property explicitly under 'properties'",
  uniqueItems: "'uniqueItems' is not supported — remove it",
  contains: "'contains' is not supported — remove it",
  minProperties: "'minProperties' is not supported — remove it",
  maxProperties: "'maxProperties' is not supported — remove it",
  definitions: "'definitions' is not supported — use '$defs' instead",
  examples: "'examples' is not supported — remove it or describe examples in 'description'"
};

const ALLOWED_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

const ALLOWED_STRING_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"]);

const MAX_NESTING_DEPTH = 10;
const MAX_TOTAL_PROPERTIES = 5000;
const MAX_TOTAL_ENUM_VALUES = 1000;
const MAX_TOTAL_STRING_SIZE = 120000;
const LARGE_ENUM_VALUE_COUNT = 250;
const LARGE_ENUM_MAX_STRING_SIZE = 15000;

// Returns the declared types of a node as a Set (handles both "type": "object" and "type": ["object", "null"])
function getTypes(node) {
  if (typeof node.type === "string") return new Set([node.type]);
  if (Array.isArray(node.type)) return new Set(node.type);
  return new Set();
}

function checkTypeSpecificKeywords(node, path, types, errors) {
  const isString = types.has("string");
  const isNumeric = types.has("number") || types.has("integer");
  const isArray = types.has("array");

  if (!isString) {
    for (const key of ["pattern", "format"]) {
      if (node[key] !== undefined) {
        errors.push(`'${key}' at '${path}' is only allowed on "type": "string" — remove it or change the type to string`);
      }
    }
  }
  if (node.format !== undefined && isString && !ALLOWED_STRING_FORMATS.has(node.format)) {
    errors.push(
      `Unsupported format '${node.format}' at '${path}' — OpenAI only supports: ${[...ALLOWED_STRING_FORMATS].join(", ")}. Use one of these or remove 'format'`
    );
  }
  if (!isNumeric) {
    for (const key of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"]) {
      if (node[key] !== undefined) {
        errors.push(`'${key}' at '${path}' is only allowed on "type": "number" or "integer" — remove it or change the type`);
      }
    }
  }
  if (!isArray) {
    for (const key of ["minItems", "maxItems"]) {
      if (node[key] !== undefined) {
        errors.push(`'${key}' at '${path}' is only allowed on "type": "array" — remove it or change the type to array`);
      }
    }
  }
}

function walkSchema(node, path, errors, defs, depth, stats) {
  if (!node || typeof node !== "object") {
    errors.push(`Schema at '${path}' must be an object, got ${node === null ? "null" : typeof node}`);
    return;
  }

  // Doc: "A schema may have up to 5000 object properties total, with up to 10 levels of nesting."
  if (depth > MAX_NESTING_DEPTH) {
    errors.push(
      `Schema at '${path}' exceeds the maximum nesting depth of ${MAX_NESTING_DEPTH} levels — flatten the structure or use '$defs' with '$ref' for recursion`
    );
    return;
  }

  // Check for disallowed keywords
  for (const key of Object.keys(node)) {
    if (!ALLOWED_KEYWORDS.has(key)) {
      const hint = UNSUPPORTED_KEYWORD_HINTS[key];
      errors.push(
        hint
          ? `Unsupported keyword '${key}' at '${path}': ${hint}`
          : `Unsupported keyword '${key}' at '${path}' — remove it (allowed keywords: ${[...ALLOWED_KEYWORDS].join(", ")})`
      );
    }
  }

  // Handle $ref — "#" (root recursion) and "#/$defs/<name>" (explicit recursion) are both supported.
  // Referenced definitions are validated separately in validateOpenAISchema, so only resolve here.
  if (node.$ref !== undefined) {
    if (typeof node.$ref !== "string" || (node.$ref !== "#" && !node.$ref.startsWith("#/$defs/"))) {
      errors.push(`$ref at '${path}' must be "#" (root recursion) or "#/$defs/<name>" — got '${node.$ref}'`);
    } else {
      const siblings = Object.keys(node).filter((k) => k !== "$ref");
      if (siblings.length > 0) {
        errors.push(`$ref at '${path}' must not have sibling keywords — remove: ${siblings.join(", ")}`);
      }
      if (node.$ref !== "#") {
        const defName = node.$ref.replace("#/$defs/", "");
        if (!defs || !defs[defName]) {
          errors.push(`$ref at '${path}' points to '#/$defs/${defName}' but no such definition exists — add it under '$defs' or fix the reference`);
        }
      }
    }
    return;
  }

  // Handle anyOf — each branch must itself be a valid schema per this subset
  if (node.anyOf !== undefined) {
    if (!Array.isArray(node.anyOf) || node.anyOf.length === 0) {
      errors.push(`'anyOf' at '${path}' must be a non-empty array of schemas`);
    } else {
      const siblings = Object.keys(node).filter((k) => !["anyOf", "description", "title"].includes(k));
      if (siblings.length > 0) {
        errors.push(`'anyOf' at '${path}' must not be combined with other keywords — move ${siblings.join(", ")} inside each anyOf branch`);
      }
      node.anyOf.forEach((branch, i) => {
        walkSchema(branch, `${path}.anyOf[${i}]`, errors, defs, depth, stats);
      });
    }
    return;
  }

  // enum / const leaves don't require 'type'
  const hasEnum = node.enum !== undefined;
  const hasConst = node.const !== undefined;

  if (hasEnum) {
    if (!Array.isArray(node.enum) || node.enum.length === 0) {
      errors.push(`'enum' at '${path}' must be a non-empty array of values`);
    } else {
      stats.enumCount += node.enum.length;
      const stringValues = node.enum.filter((v) => typeof v === "string");
      const enumStringSize = stringValues.reduce((sum, v) => sum + v.length, 0);
      stats.stringSize += enumStringSize;
      // Doc: for a single enum with >250 string values, total string length of values must be <= 15,000 chars
      if (stringValues.length > LARGE_ENUM_VALUE_COUNT && enumStringSize > LARGE_ENUM_MAX_STRING_SIZE) {
        errors.push(
          `'enum' at '${path}' has ${stringValues.length} string values totaling ${enumStringSize} characters — enums with more than ${LARGE_ENUM_VALUE_COUNT} values cannot exceed ${LARGE_ENUM_MAX_STRING_SIZE} characters in total. Reduce the number or length of enum values`
        );
      }
    }
  }
  if (hasConst && typeof node.const === "string") {
    stats.stringSize += node.const.length;
  }

  // Validate 'type' presence and value
  if (node.type === undefined) {
    if (!hasEnum && !hasConst) {
      errors.push(`Schema at '${path}' must define 'type' (or use $ref/anyOf/enum/const)`);
    }
  } else if (typeof node.type === "string") {
    if (!ALLOWED_TYPES.has(node.type)) {
      errors.push(`Invalid type '${node.type}' at '${path}' — allowed types: ${[...ALLOWED_TYPES].join(", ")}`);
    }
  } else if (Array.isArray(node.type)) {
    for (const t of node.type) {
      if (!ALLOWED_TYPES.has(t)) {
        errors.push(`Invalid type '${t}' in type array at '${path}' — allowed types: ${[...ALLOWED_TYPES].join(", ")}`);
      }
    }
  } else {
    errors.push(`'type' at '${path}' must be a string or an array of strings, e.g. "string" or ["string", "null"]`);
  }

  const types = getTypes(node);
  checkTypeSpecificKeywords(node, path, types, errors);

  if (node.required !== undefined && !Array.isArray(node.required)) {
    errors.push(`'required' at '${path}' must be an array of property names`);
  }

  // Handle object type (including nullable objects like ["object", "null"])
  if (types.has("object")) {
    if (node.additionalProperties !== false) {
      errors.push(`Object at '${path}' must set "additionalProperties": false — OpenAI requires this on every object`);
    }

    if (!node.properties || typeof node.properties !== "object" || Array.isArray(node.properties)) {
      errors.push(`Object at '${path}' must define 'properties' as an object`);
    } else {
      const propKeys = Object.keys(node.properties);
      const propKeySet = new Set(propKeys);
      const requiredArr = Array.isArray(node.required) ? node.required : [];
      const required = new Set(requiredArr);

      for (const r of requiredArr) {
        if (!propKeySet.has(r)) {
          errors.push(
            `'required' at '${path}' lists '${r}' but it is not defined in 'properties' — remove it from 'required' or add it to 'properties'`
          );
        }
      }

      for (const key of propKeys) {
        stats.propCount++;
        stats.stringSize += key.length;
        if (!required.has(key)) {
          errors.push(
            `Property '${key}' at '${path}' must be listed in 'required' — OpenAI requires all properties to be required; for optional fields use "type": ["<type>", "null"]`
          );
        }
        walkSchema(node.properties[key], `${path}.${key}`, errors, defs, depth + 1, stats);
      }
    }
  }

  // Handle array type (including nullable arrays like ["array", "null"])
  if (types.has("array")) {
    if (!node.items || typeof node.items !== "object" || Array.isArray(node.items)) {
      errors.push(`Array at '${path}' must define 'items' as a single schema object (tuple-style arrays are not supported)`);
    } else {
      walkSchema(node.items, `${path}.items`, errors, defs, depth + 1, stats);
    }
  }
}

export function validateOpenAISchema(jsonSchemaObj) {
  const errors = [];

  if (!jsonSchemaObj || typeof jsonSchemaObj !== "object" || Object.keys(jsonSchemaObj).length === 0) {
    return { isValid: false, errors: ["json_schema must be a valid object with 'name', 'strict' and 'schema' fields"] };
  }

  // Check name
  if (!jsonSchemaObj.name || typeof jsonSchemaObj.name !== "string") {
    errors.push("json_schema.name is required and must be a non-empty string");
  } else if (!/^[a-zA-Z0-9_-]{1,64}$/.test(jsonSchemaObj.name)) {
    errors.push(
      `json_schema.name '${jsonSchemaObj.name}' is invalid — it may only contain letters, numbers, underscores and dashes, with a maximum length of 64 characters`
    );
  }

  // Check strict
  if (jsonSchemaObj.strict !== true) {
    errors.push("json_schema.strict must be set to true for structured outputs");
  }

  const schema = jsonSchemaObj.schema;
  if (!schema || typeof schema !== "object") {
    errors.push("json_schema.schema is required and must be an object");
    return { isValid: false, errors };
  }

  // Root must be type: "object" and must not be anyOf
  if (schema.anyOf !== undefined) {
    errors.push(
      'Root schema must not use \'anyOf\' — wrap the union in an object property instead, e.g. { "type": "object", "properties": { "result": { "anyOf": [...] } }, ... }'
    );
  } else if (schema.type !== "object") {
    errors.push(`Root schema must have "type": "object" — got '${Array.isArray(schema.type) ? schema.type.join(", ") : schema.type}'`);
  }

  const stats = { propCount: 0, enumCount: 0, stringSize: 0 };
  const defs = schema.$defs && typeof schema.$defs === "object" ? schema.$defs : {};

  walkSchema(schema, "root", errors, defs, 1, stats);

  // Validate every definition once (covers refs and catches invalid unused definitions)
  for (const [defName, defSchema] of Object.entries(defs)) {
    stats.stringSize += defName.length;
    walkSchema(defSchema, `$defs.${defName}`, errors, defs, 1, stats);
  }

  if (stats.propCount > MAX_TOTAL_PROPERTIES) {
    errors.push(
      `Schema has ${stats.propCount} total properties — OpenAI allows a maximum of ${MAX_TOTAL_PROPERTIES}. Remove or consolidate properties`
    );
  }
  if (stats.enumCount > MAX_TOTAL_ENUM_VALUES) {
    errors.push(
      `Schema has ${stats.enumCount} total enum values — OpenAI allows a maximum of ${MAX_TOTAL_ENUM_VALUES} across all enums. Reduce the number of enum values`
    );
  }
  if (stats.stringSize > MAX_TOTAL_STRING_SIZE) {
    errors.push(
      `Total string size of property names, definition names, enum and const values is ${stats.stringSize} characters — OpenAI allows a maximum of ${MAX_TOTAL_STRING_SIZE}. Shorten names or enum values`
    );
  }

  return { isValid: errors.length === 0, errors };
}
