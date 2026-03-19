function collectVariableStructure(node, structure = {}, aliasMap = {}) {
  if (typeof node === "string") {
    const matches = node.match(/\{\{([^}]+)\}\}/g);
    if (matches) {
      for (const match of matches) {
        const inner = match.slice(2, -2).trim();

        // 1) Indexed legacy: items[0].name
        const arrayMatch = inner.match(/^([a-zA-Z_]\w*)\[\d+\]\.(\w+)$/);
        if (arrayMatch) {
          const root = arrayMatch[1];
          const field = arrayMatch[2];
          if (!structure[root]) structure[root] = { type: "array", fields: new Set() };
          structure[root].type = "array";
          structure[root].fields.add(field);
          continue;
        }

        // 2) Dot-notation: alias.field (e.g. item.name, buttons.label)
        const objMatch = inner.match(/^([a-zA-Z_]\w*)\.(\w+)$/);
        if (objMatch) {
          const root = objMatch[1];
          const field = objMatch[2];
          // If root is a known item alias, map to the real binding key as array
          const bindingKey = aliasMap[root];
          if (bindingKey) {
            if (!structure[bindingKey]) structure[bindingKey] = { type: "array", fields: new Set() };
            structure[bindingKey].type = "array";
            structure[bindingKey].fields.add(field);
          } else {
            // Regular object (e.g. buttons.label, headers.name)
            if (!structure[root]) structure[root] = { type: "object", fields: new Set() };
            if (structure[root].type !== "array") structure[root].type = "object";
            structure[root].fields.add(field);
          }
          continue;
        }

        // 3) Scalar: total
        const scalarMatch = inner.match(/^([a-zA-Z_]\w*)$/);
        if (scalarMatch) {
          const root = scalarMatch[1];
          // Skip bare alias names (they are not top-level variables)
          if (!aliasMap[root] && !structure[root]) {
            structure[root] = { type: "string", fields: new Set() };
          }
          continue;
        }
      }
    }
  } else if (Array.isArray(node)) {
    node.forEach((item) => collectVariableStructure(item, structure, aliasMap));
  } else if (node && typeof node === "object") {
    if (node.type === "ListView" && node.binding) {
      // Extract the real binding key from either:
      //   "{{trips}}"  → "trips"   (placeholder style — binding is a variable reference)
      //   "rows"        → "rows"    (direct key style)
      const placeholderMatch = typeof node.binding === "string" ? node.binding.match(/^\{\{([a-zA-Z_]\w*)\}\}$/) : null;
      const bindingKey = placeholderMatch ? placeholderMatch[1] : node.binding;

      // Ensure the binding key is registered as an array in the schema
      if (bindingKey) {
        if (!structure[bindingKey]) structure[bindingKey] = { type: "array", fields: new Set() };
        structure[bindingKey].type = "array";
      }

      // Find the item alias:
      //   New mode:    node.itemAlias (e.g. "item")
      //   Legacy mode: ListViewItem.key on first child (e.g. "row")
      const alias = node.itemAlias || node.children?.[0]?.key || node.key || "item";

      const newAliasMap = { ...aliasMap, [alias]: bindingKey };

      if (node.itemTemplate) {
        // New generic mode — scan itemTemplate
        collectVariableStructure(node.itemTemplate, structure, newAliasMap);
      } else if (node.children) {
        // Legacy mode — item template is first child; scan all children equally
        collectVariableStructure(node.children, structure, newAliasMap);
      }

      // Scan remaining scalar/layout props (gap, direction, etc.) but NOT binding again
      const rest = Object.fromEntries(Object.entries(node).filter(([k]) => !["itemTemplate", "children", "binding"].includes(k)));
      Object.values(rest).forEach((v) => collectVariableStructure(v, structure, aliasMap));
    } else {
      Object.values(node).forEach((v) => collectVariableStructure(v, structure, aliasMap));
    }
  }
  return structure;
}

const ON_CLICK_ACTION_TYPES = ["reply", "sendDataToFrontend"];

function extractOnClickTypeFieldNames(node, result = new Set()) {
  if (typeof node === "string") return result;
  if (Array.isArray(node)) {
    node.forEach((item) => extractOnClickTypeFieldNames(item, result));
    return result;
  }
  if (!node || typeof node !== "object") return result;

  if (node.type === "Button" && node.onClickAction?.type) {
    const val = String(node.onClickAction.type);
    // {{alias.fieldName}} → capture last segment
    const dotMatch = val.match(/^\s*\{\{[^}]*\.([^}.]+)\}\}\s*$/);
    if (dotMatch) {
      result.add(dotMatch[1].trim());
    } else {
      // {{fieldName}} → simple scalar
      const simpleMatch = val.match(/^\s*\{\{([a-zA-Z_]\w*)\}\}\s*$/);
      if (simpleMatch) result.add(simpleMatch[1].trim());
    }
  }

  Object.values(node).forEach((v) => extractOnClickTypeFieldNames(v, result));
  return result;
}

function extractActionDataFields(node, fieldsSet = new Set()) {
  if (typeof node === "string") return fieldsSet;
  if (Array.isArray(node)) {
    node.forEach((item) => extractActionDataFields(item, fieldsSet));
  } else if (node && typeof node === "object") {
    if (node.type === "Button") {
      // Legacy format: payload.action_data = "{{alias.fieldName}}"
      if (node.payload && typeof node.payload.action_data === "string") {
        const match = node.payload.action_data.match(/\{\{([^}]+)\}\}/);
        if (match) {
          const parts = match[1].replace(/\[\d+\]/g, "").split(".");
          fieldsSet.add(parts[parts.length - 1]);
        }
      }
      // New format: onClickAction = "{{alias.fieldName}}" (whole action object as a variable)
      if (typeof node.onClickAction === "string") {
        const match = node.onClickAction.match(/\{\{([^}]+)\}\}/);
        if (match) {
          const parts = match[1].replace(/\[\d+\]/g, "").split(".");
          fieldsSet.add(parts[parts.length - 1]);
        }
      }
    }
    Object.values(node).forEach((v) => extractActionDataFields(v, fieldsSet));
  }
  return fieldsSet;
}

function buildSchemaFromTemplateFormat(templateFormat, typeOverrides = {}, variables = {}, meta = {}) {
  const actionDataFields = extractActionDataFields(templateFormat);
  const onClickTypeFieldNames = extractOnClickTypeFieldNames(templateFormat);
  const getActionDataSchema = (f) => ({
    type: "object",
    description: `Action data field "${f}"`,
    properties: {
      type: { type: "string", enum: ON_CLICK_ACTION_TYPES },
      value: { type: "string" },
      data: {
        type: "object",
        properties: {
          id: { type: "string" }
        },
        required: ["id"],
        additionalProperties: false
      }
    },
    required: ["type", "value", "data"],
    additionalProperties: false
  });

  const structure = collectVariableStructure(templateFormat);
  const rootKeys = Object.keys(structure);
  const properties = {};

  // Derive schema from an actual JS value (handles nested objects/arrays/primitives)
  function getSchemaForValue(value) {
    if (Array.isArray(value)) {
      if (value.length > 0) {
        return { type: "array", items: getSchemaForValue(value[0]) };
      }
      return { type: "array" };
    } else if (value !== null && typeof value === "object") {
      const props = {};
      const required = [];
      for (const k in value) {
        props[k] = getSchemaForValue(value[k]);
        required.push(k);
      }
      return { type: "object", properties: props, required, additionalProperties: false };
    } else if (typeof value === "number") {
      return { type: "number" };
    } else if (typeof value === "boolean") {
      return { type: "boolean" };
    } else {
      return { type: "string" };
    }
  }

  function applyFieldOverrides(schema) {
    if (schema.type !== "object" || !schema.properties) return schema;
    const newProps = {};
    for (const [f, propSchema] of Object.entries(schema.properties)) {
      if (onClickTypeFieldNames.has(f)) {
        newProps[f] = { type: "string", enum: ON_CLICK_ACTION_TYPES };
      } else if (propSchema.type === "object") {
        newProps[f] = applyFieldOverrides(propSchema);
      } else {
        newProps[f] = propSchema;
      }
    }
    return { ...schema, properties: newProps };
  }

  rootKeys.forEach((key) => {
    if (typeOverrides[key]) {
      properties[key] = typeOverrides[key];
      return;
    }
    const actualValue = variables?.[key];
    if (actualValue !== undefined && actualValue !== null && typeof actualValue === "object") {
      properties[key] = applyFieldOverrides(getSchemaForValue(actualValue));
      return;
    }

    const info = structure[key];

    const getFieldSchema = (f, context) => {
      if (actionDataFields.has(f) || f === "actionData" || onClickTypeFieldNames.has(f)) return getActionDataSchema(f);
      return { type: "string", description: `Field "${f}" of ${context}` };
    };

    if (info.type === "array") {
      const itemProperties = {};
      info.fields.forEach((f) => {
        itemProperties[f] = getFieldSchema(f, `a ${key} item`);
      });
      properties[key] = {
        type: "array",
        description: `Array of ${key} items`,
        items: {
          type: "object",
          properties: itemProperties,
          required: Array.from(info.fields),
          additionalProperties: false
        }
      };
    } else if (info.type === "object") {
      const objProperties = {};
      info.fields.forEach((f) => {
        objProperties[f] = getFieldSchema(f, `the ${key} object`);
      });
      properties[key] = {
        type: "object",
        description: `Object for ${key}`,
        properties: objProperties,
        required: Array.from(info.fields),
        additionalProperties: false
      };
    } else {
      // Scalar / simple
      if (actionDataFields.has(key) || key === "actionData" || onClickTypeFieldNames.has(key)) {
        properties[key] = getActionDataSchema(key);
      } else {
        properties[key] = { type: "string", description: `Value for ${key}` };
      }
    }
  });

  const rootSchema = {
    type: "object",
    title: meta.name || "",
    description: meta.description || "",
    properties,
    required: rootKeys,
    additionalProperties: false
  };

  _applyStrict(rootSchema);

  return {
    name: "RichUI_Variables",
    strict: true,
    schema: rootSchema
  };
}

// Private helper to recursively apply additionalProperties: false
function _applyStrict(node) {
  if (node && typeof node === "object") {
    if (node.type === "object" && node.additionalProperties === undefined) {
      node.additionalProperties = false;
    }
    if (node.properties) {
      Object.values(node.properties).forEach(_applyStrict);
    }
    if (node.items) {
      _applyStrict(node.items);
    }
  }
}

function buildDefaultValues(templateFormat) {
  const defaults = {};
  const structure = collectVariableStructure(templateFormat);

  Object.keys(structure).forEach((key) => {
    const info = structure[key];
    if (info.type === "array") {
      defaults[key] = [];
    } else if (info.type === "object") {
      defaults[key] = {};
    } else {
      defaults[key] = "";
    }
  });

  return defaults;
}

export { buildSchemaFromTemplateFormat, buildDefaultValues };
