const SKIP_KEYS = new Set(["prompt", "model", "type", "system_prompt_version_id", "is_rich_text", "provider_config"]);

const transformToDbFormat = (configuration) => {
  if (!configuration || typeof configuration !== "object") {
    return configuration;
  }
  const transformed = {};

  for (const [key, value] of Object.entries(configuration)) {
    if (SKIP_KEYS.has(key)) {
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

const transformToFrontendFormat = (configuration) => {
  if (!configuration || typeof configuration !== "object") {
    return configuration;
  }
  const transformed = {};
  for (const [key, value] of Object.entries(configuration)) {
    if (SKIP_KEYS.has(key)) {
      transformed[key] = value;
      continue;
    }
    if (value && typeof value === "object" && "mode" in value) {
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
      const { configuration } = req.body;
      if (configuration && typeof configuration === "object") {
        const transformedConfig = transformToDbFormat(configuration);
        req.body.configuration = transformedConfig;
      }
    }
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
  if (transformed.configuration) {
    transformed.configuration = transformToFrontendFormat(transformed.configuration);
  }
  if (transformed.agent && transformed.agent.bridges) {
    transformed.agent = transformAgentItemToFrontend(transformed.agent);
  }

  return transformed;
}

export { transformToDbFormat, transformToFrontendFormat, isDbFormat };
