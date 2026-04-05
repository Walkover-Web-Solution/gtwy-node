import { modelConfigDocument } from "./loadModelConfigs.js";

/**
 * Get the set of advanced parameter keys for a given service and model.
 * Advanced parameters are identified by their field type (slider) or typeOf value.
 * @param {string} service - The service name (e.g., 'openai', 'anthropic')
 * @param {string} model - The model name
 * @returns {Set<string>} Set of advanced parameter keys
 */
const getAdvancedParamKeys = (service, model) => {
  if (!service || !model) return new Set();

  const serviceLower = service.toLowerCase();
  const modelConfig = modelConfigDocument[serviceLower]?.[model];
  if (!modelConfig) {
    return new Set();
  }

  const advancedKeys = new Set();
  const config = modelConfig.configuration || {};

  for (const key of Object.keys(config)) {
    // Skip 'model' key itself
    if (key === "model") continue;

    // All other keys are advanced parameters
    advancedKeys.add(key);
  }
  return advancedKeys;
};

/**
 * Transform configuration from frontend format to DB storage format.
 * For advanced parameters, stores as { mode, value } object.
 * For regular parameters, stores as-is.
 *
 * Frontend format: { creativity_level: 0.7, max_tokens: "default", model: "gpt-4" }
 * DB format: { creativity_level: { mode: "custom", value: 0.7 }, max_tokens: { mode: "default", value: null }, model: "gpt-4" }
 *
 * @param {Object} configuration - Configuration object from frontend
 * @param {string} service - The service name
 * @param {string} model - The model name
 * @returns {Object} Transformed configuration for DB storage
 */
const transformToDbFormat = (configuration, service, model) => {
  if (!configuration || typeof configuration !== "object") {
    return configuration;
  }
  const advancedKeys = getAdvancedParamKeys(service, model);
  const transformed = {};

  for (const [key, value] of Object.entries(configuration)) {
    // Skip non-advanced parameters - store as-is
    if (!advancedKeys.has(key)) {
      transformed[key] = value;
      continue;
    }

    // If already in DB format (has mode property), keep as-is
    if (value && typeof value === "object" && "mode" in value) {
      transformed[key] = value;
      continue;
    }

    // Transform to DB format based on value type
    if (value === "default" || value === "min" || value === "max") {
      transformed[key] = {
        mode: value,
        value: null
      };
    } else if (typeof value === "number") {
      transformed[key] = {
        mode: "custom",
        value: value
      };
    } else if (value === null || value === undefined) {
      transformed[key] = {
        mode: "default",
        value: null
      };
    } else {
      // For any other case, store as-is
      transformed[key] = {
        mode: "custom",
        value: value
      };
    }
  }
  return transformed;
};

/**
 * Transform configuration from DB storage format to frontend format.
 * For advanced parameters, flattens { mode, value } to the appropriate value.
 * For regular parameters, returns as-is.
 *
 * DB format: { creativity_level: { mode: "custom", value: 0.7 }, max_tokens: { mode: "default", value: null } }
 * Frontend format: { creativity_level: 0.7, max_tokens: "default" }
 *
 * @param {Object} configuration - Configuration object from DB
 * @param {string} service - The service name
 * @param {string} model - The model name
 * @returns {Object} Transformed configuration for frontend
 */
const transformToFrontendFormat = (configuration, service, model) => {
  if (!configuration || typeof configuration !== "object") {
    return configuration;
  }
  const advancedKeys = getAdvancedParamKeys(service, model);
  const transformed = {};
  for (const [key, value] of Object.entries(configuration)) {
    // Check if this is an advanced parameter stored in DB format
    if (advancedKeys.has(key) && value && typeof value === "object" && "mode" in value) {
      // Convert from DB format to frontend format
      if (value.mode === "custom") {
        transformed[key] = value.value;
      } else {
        // mode is "default", "min", or "max"
        transformed[key] = value.mode;
      }
    } else {
      // Regular parameter or old format - return as-is
      transformed[key] = value;
    }
  }
  return transformed;
};

/**
 * Check if a configuration value is in DB format (has mode/value structure)
 * @param {*} value - The value to check
 * @returns {boolean}
 */
const isDbFormat = (value) => {
  return value && typeof value === "object" && "mode" in value && "value" in value;
};

// ==================== MIDDLEWARE FUNCTIONS ====================

/**
 * Middleware to transform request body from frontend format to DB format
 * Handles configuration transformation for agent create/update operations
 */
export const transformAgentAdvanceParametersMiddleware = (req, res, next) => {
  try {
    // Check if there's a request body with configuration
    if (req.body && Object.keys(req.body).length > 0) {
      const { service, model, configuration } = req.body;
      // If we have service, model, and configuration, transform the configuration
      if (service && model && configuration && typeof configuration === "object") {
        const transformedConfig = transformToDbFormat(configuration, service, model);
        req.body.configuration = transformedConfig;
      }
    }
    next();
  } catch (error) {
    console.error("Error in transformAgentAdvanceParametersMiddleware:", error);
    next();
  }
};

/**
 * Middleware to transform response data from DB format to frontend format
 * Intercepts res.json() calls to transform data before sending to client
 */
export const transformToFrontendFormatMiddleware = (req, res, next) => {
  try {
    // Store original res.json to intercept final response
    const originalJson = res.json;
    res.json = function (data) {
      // Transform the response data
      const transformedData = transformResponseDataToFrontend(data);
      // Call original json with transformed data
      return originalJson.call(this, transformedData);
    };
    next();
  } catch (error) {
    console.error("Error in transformToFrontendFormatMiddleware:", error);
    next();
  }
};

/**
 * Transform response data structure to frontend format
 * Handles different response structures (agent, agents, bridges, data arrays)
 */
function transformResponseDataToFrontend(data) {
  if (!data || typeof data !== "object") {
    return data;
  }

  // Handle single agent object (most common case)
  if (data.agent && typeof data.agent === "object") {
    data.agent = transformAgentItemToFrontend(data.agent);
  }

  return data;
}

/**
 * Transform a single agent/bridge item to frontend format
 * Handles both bridge configuration and direct configuration structures
 */
function transformAgentItemToFrontend(item) {
  if (!item || typeof item !== "object") {
    return item;
  }
  const transformed = { ...item };
  // Handle direct configuration (top-level)
  if (transformed.configuration && transformed.service) {
    const service = transformed.service;
    const model = transformed.configuration?.model;

    if (service && model) {
      transformed.configuration = transformToFrontendFormat(transformed.configuration, service, model);
    }
  }

  // Handle nested agent data
  if (transformed.agent && transformed.agent.bridges) {
    transformed.agent = transformAgentItemToFrontend(transformed.agent);
  }

  return transformed;
}

// ==================== EXPORTS ====================

export { getAdvancedParamKeys, transformToDbFormat, transformToFrontendFormat, isDbFormat };
