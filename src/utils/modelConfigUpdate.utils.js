import { flatten } from "flat";

const ALLOWED_MODEL_UPDATE_OPERATORS = new Set(["$set", "$unset", "$inc", "$push", "$pull", "$addToSet", "$rename"]);
const BLOCKED_MODEL_CONFIG_PATHS = ["_id", "__v", "model_name", "service", "org_id"];
const ALLOWED_MODEL_CONFIG_ROOTS = ["configuration", "validationConfig", "outputConfig", "status", "display_name"];
const BLOCKED_MODEL_FILTER_PATHS = ["_id", "__v", "org_id"];

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isBlockedPath(path) {
  if (path === "configuration.model" || path.startsWith("configuration.model.")) {
    return true;
  }

  return BLOCKED_MODEL_CONFIG_PATHS.some((blockedPath) => path === blockedPath || path.startsWith(`${blockedPath}.`));
}

function isAllowedPath(path) {
  return ALLOWED_MODEL_CONFIG_ROOTS.some((root) => path === root || path.startsWith(`${root}.`));
}

function isBlockedFilterPath(path) {
  return BLOCKED_MODEL_FILTER_PATHS.some((blockedPath) => path === blockedPath || path.startsWith(`${blockedPath}.`));
}

function hasBlockedOperatorPath(path) {
  return path.startsWith("$") || path.includes(".$");
}

function normalizeBulkModelConfigChange(change) {
  if (!isPlainObject(change) || Object.keys(change).length === 0) {
    return { error: "invalidChange" };
  }

  const keys = Object.keys(change);
  const hasOperator = keys.some((key) => key.startsWith("$"));

  if (hasOperator) {
    const mixedPayload = keys.some((key) => !key.startsWith("$"));
    if (mixedPayload) {
      return { error: "invalidChange" };
    }

    const normalizedUpdate = {};
    let errorKey = "";

    for (const [operator, payload] of Object.entries(change)) {
      if (!ALLOWED_MODEL_UPDATE_OPERATORS.has(operator) || !isPlainObject(payload)) {
        return { error: "invalidChange" };
      }

      const validOperatorPayload = {};

      for (const [key, value] of Object.entries(payload)) {
        if (isBlockedPath(key) || !isAllowedPath(key)) {
          errorKey = key;
          continue;
        }

        if (operator === "$rename") {
          if (typeof value !== "string" || isBlockedPath(value) || !isAllowedPath(value)) {
            errorKey = typeof value === "string" ? value : key;
            continue;
          }
        }

        validOperatorPayload[key] = value;
      }

      if (Object.keys(validOperatorPayload).length > 0) {
        normalizedUpdate[operator] = validOperatorPayload;
      }
    }

    if (Object.keys(normalizedUpdate).length === 0) {
      return { error: "keyError", key: errorKey };
    }

    return { updateDocument: normalizedUpdate };
  }

  const flattenedUpdates = flatten(change, { safe: true });
  const allowedUpdates = {};
  let errorKey = "";

  for (const [key, value] of Object.entries(flattenedUpdates)) {
    if (isBlockedPath(key) || !isAllowedPath(key)) {
      errorKey = key;
      continue;
    }
    allowedUpdates[key] = value;
  }

  if (Object.keys(allowedUpdates).length === 0) {
    return { error: "keyError", key: errorKey };
  }

  return { updateDocument: { $set: allowedUpdates } };
}

function normalizeBulkModelConfigFilter(filter) {
  if (!filter) {
    return { filterQuery: {} };
  }

  if (!isPlainObject(filter) || Object.keys(filter).length === 0) {
    return { error: "invalidFilter" };
  }

  const flattenedFilter = flatten(filter, { safe: true });
  const normalizedFilter = {};
  let errorKey = "";

  for (const [key, value] of Object.entries(flattenedFilter)) {
    if (hasBlockedOperatorPath(key) || isBlockedFilterPath(key)) {
      errorKey = key;
      continue;
    }
    normalizedFilter[key] = value;
  }

  if (Object.keys(normalizedFilter).length === 0) {
    return { error: "invalidFilter", key: errorKey };
  }

  return { filterQuery: normalizedFilter };
}

export { normalizeBulkModelConfigChange, normalizeBulkModelConfigFilter };
