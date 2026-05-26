import { validateOpenAISchema } from "./openaiSchemaValidator.utils.js";

const validateJsonSchemaConfiguration = (configuration) => {
  if (!configuration || !configuration.response_type) {
    return { isValid: true, errorMessage: null };
  }

  const response_type = configuration.response_type;

  if (!response_type) {
    return { isValid: true, errorMessage: null };
  }

  if (typeof response_type === "string") {
    return { isValid: true, errorMessage: null };
  }

  if (response_type.type !== "json_schema") {
    return { isValid: true, errorMessage: null };
  }

  if ("json_schema" in response_type && response_type.json_schema === null) {
    return { isValid: false, errorMessage: "json_schema should be a valid JSON, not None" };
  }

  if ("json_schema" in response_type && response_type.json_schema !== null) {
    try {
      let jsonSchema;
      if (typeof response_type.json_schema === "object") {
        jsonSchema = response_type.json_schema;
      } else if (typeof response_type.json_schema === "string") {
        jsonSchema = JSON.parse(response_type.json_schema);
      } else {
        return { isValid: false, errorMessage: "json_schema should be a valid JSON object or string" };
      }

      const { isValid, errors } = validateOpenAISchema(jsonSchema);
      if (!isValid) {
        return { isValid: false, errorMessage: errors.join("; ") };
      }
      return { isValid: true, errorMessage: null };
    } catch {
      return { isValid: false, errorMessage: "json_schema should be a valid JSON" };
    }
  }

  return { isValid: true, errorMessage: null };
};

import { modelConfigDocument } from "./loadModelConfigs.js";

const getServiceByModel = (model) => {
  for (const service in modelConfigDocument) {
    if (modelConfigDocument[service][model]) {
      return service;
    }
  }
  return null;
};

export { validateJsonSchemaConfiguration, getServiceByModel };
