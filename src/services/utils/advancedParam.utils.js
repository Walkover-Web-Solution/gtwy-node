import { modelConfigDocument } from "./loadModelConfigs.js";

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
    if (key === "model") continue;
    advancedKeys.add(key);
  }
  return advancedKeys;
};

const transformToDbFormat = (configuration, service, model) => {
  if (!configuration || typeof configuration !== "object") {
    return configuration;
  }
  const advancedKeys = getAdvancedParamKeys(service, model);
  const transformed = {};

  for (const [key, value] of Object.entries(configuration)) {
    if (!advancedKeys.has(key)) {
      transformed[key] = value;
      continue;
    }
    if (value && typeof value === "object" && "mode" in value) {
      transformed[key] = value;
      continue;
    }
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
      transformed[key] = {
        mode: "custom",
        value: value
      };
    }
  }
  return transformed;
};

const transformToFrontendFormat = (configuration, service, model) => {
  if (!configuration || typeof configuration !== "object") {
    return configuration;
  }
  const advancedKeys = getAdvancedParamKeys(service, model);
  const transformed = {};
  for (const [key, value] of Object.entries(configuration)) {
    if (advancedKeys.has(key) && value && typeof value === "object" && "mode" in value) {
      if (value.mode === "custom") {
        transformed[key] = value.value;
      } else {
        transformed[key] = value.mode;
      }
    } else {
      transformed[key] = value;
    }
  }
  return transformed;
};

const isDbFormat = (value) => {
  return value && typeof value === "object" && "mode" in value && "value" in value;
};

export const transformAgentAdvanceParametersMiddleware = (req, res, next) => {
  try {
    if (req.body && Object.keys(req.body).length > 0) {
      const { service, model, configuration } = req.body;
      if (service && model && configuration && typeof configuration === "object") {
        const transformedConfig = transformToDbFormat(configuration, service, model);
        req.body.configuration = transformedConfig;
      }
    }
    delete req.body.service;
    delete req.body.model;
    next();
  } catch (error) {
    console.error("Error in transformAgentAdvanceParametersMiddleware:", error);
    next();
  }
};

export const transformToFrontendFormatMiddleware = (req, res, next) => {
  try {
    const originalJson = res.json;
    res.json = function (data) {
      const transformedData = transformResponseDataToFrontend(data);
      return originalJson.call(this, transformedData);
    };
    next();
  } catch (error) {
    console.error("Error in transformToFrontendFormatMiddleware:", error);
    next();
  }
};

function transformResponseDataToFrontend(data) {
  if (!data || typeof data !== "object") {
    return data;
  }

  // Handle single agent object
  if (data.agent && typeof data.agent === "object") {
    data.agent = transformAgentItemToFrontend(data.agent);
  }

  // Handle agents array
  if (data.agents && Array.isArray(data.agents)) {
    data.agents = data.agents.map((agent) => transformAgentItemToFrontend(agent));
  }

  // Handle bridges array
  if (data.bridges && Array.isArray(data.bridges)) {
    data.bridges = data.bridges.map((bridge) => transformAgentItemToFrontend(bridge));
  }

  // Handle generic data array
  if (data.data && Array.isArray(data.data)) {
    data.data = data.data.map((item) => transformAgentItemToFrontend(item));
  }

  return data;
}

function transformAgentItemToFrontend(item) {
  if (!item || typeof item !== "object") {
    return item;
  }
  const transformed = { ...item };
  if (transformed.configuration && transformed.service) {
    const service = transformed.service;
    const model = transformed.configuration?.model;

    if (service && model) {
      transformed.configuration = transformToFrontendFormat(transformed.configuration, service, model);
    }
  }
  if (transformed.agent && transformed.agent.bridges) {
    transformed.agent = transformAgentItemToFrontend(transformed.agent);
  }

  return transformed;
}

export { getAdvancedParamKeys, transformToDbFormat, transformToFrontendFormat, isDbFormat };
