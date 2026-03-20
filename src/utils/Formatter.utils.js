// ----------------- PATH HELPER -----------------
function applyVariables(ui, variables) {
  function replaceVars(value, context = {}) {
    if (typeof value !== "string") return value;

    return value.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      path = path.trim();

      // support nested keys like place.name or trips[0].image
      const keys = path.replace(/\[(\d+)\]/g, ".$1").split(".");

      let source = keys[0] in context ? context : variables;

      let val = source;
      for (const k of keys) {
        if (val == null || typeof val !== "object") return match;
        val = val[k];
      }
      return val !== undefined ? val : match;
    });
  }

  function processNode(node, context = {}) {
    if (Array.isArray(node)) {
      return node.map(n => processNode(n, context));
    }

    if (typeof node !== "object" || node === null) {
      return replaceVars(node, context);
    }

    // Handle ListView binding
    if (node.type === "ListView" && node.binding) {
      const listKey = node.binding.replace(/[{}]/g, "").trim();

      const keys = listKey.replace(/\[(\d+)\]/g, ".$1").split(".");
      let listData = variables;
      for (const k of keys) {
        if (listData == null || typeof listData !== "object") {
          listData = undefined;
          break;
        }
        listData = listData[k];
      }

      const items = Array.isArray(listData) ? listData : [];

      // If the AI only wrote 1 child array element as a template
      if (Array.isArray(node.children) && node.children.length === 1 && items.length > 0) {
        return {
          ...node,
          children: items.map(item => {
            // merge context, also provide `place` or root specific variable `item`
            const localContext = (item && typeof item === "object" && !Array.isArray(item))
              ? { ...context, ...item, place: item, item }
              : { ...context, place: item, item };
            return processNode(node.children[0], localContext);
          })
        };
      }
    }

    const result = {};
    for (const key in node) {
      result[key] = processNode(node[key], context);
    }

    return result;
  }

  return processNode(ui);
}



/**
 * Generates a JSON schema from a card template
 * @param {Object} cardJson - The card JSON template
 * @param {string} schemaName - Name for the schema (default: "nested_ui_components")
 * @param {string} varPrefix - Variable prefix (default: "vars")
 * @returns {Object} - Object containing schema and variables
 */


function getByPath(obj, path) {
  try {
    const tokens = [];
    path.split(".").forEach((part) => {
      const re = /([^\[]+)|\[(\d+)\]/g;
      let m;
      while ((m = re.exec(part))) {
        if (m[1]) tokens.push(m[1]);
        if (m[2]) tokens.push(Number(m[2]));
      }
    });

    let cur = obj;
    for (const t of tokens) {
      if (cur == null) return undefined;
      cur = cur[t];
    }
    return cur;
  } catch {
    return undefined;
  }
}

function buildVariables(template, descMap, varPrefix = "vars") {
  const vars = {};
  for (const path of Object.keys(descMap)) {
    vars[path] = {
      description: descMap[path] || "",
      example: getByPath(template, path),
      value: `{{${varPrefix}.${path}}}` // variable placeholder
    };
  }
  return vars;
}

export { applyVariables, buildVariables };
