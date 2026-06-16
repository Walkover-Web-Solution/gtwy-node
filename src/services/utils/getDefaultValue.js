import { modelConfigDocument } from "./loadModelConfigs.js";

const service_name = {
  openai: "openai",
  anthropic: "anthropic",
  groq: "groq",
  grok: "grok",
  deepseek: "deepseek",
  open_router: "open_router",
  mistral: "mistral",
  gemini: "gemini",
  openai_completion: "openai_completion",
  deepgram: "deepgram",
  neev_cloud: "neev_cloud",
  moonshot: "moonshot"
};

const validateFallBack = (fall_back_data) => {
  if (typeof fall_back_data !== "object" || fall_back_data === null) {
    throw new Error("fall_back must be a dictionary");
  }

  const required_fields = ["is_enable", "service", "model"];
  for (const field of required_fields) {
    if (!(field in fall_back_data)) {
      throw new Error(`fall_back missing required field: ${field}`);
    }
  }

  if (typeof fall_back_data.is_enable !== "boolean") {
    throw new Error("fall_back.is_enable must be a boolean");
  }

  if (fall_back_data.is_enable) {
    const service = fall_back_data.service;
    const model = fall_back_data.model;

    if (!modelConfigDocument[service]) {
      throw new Error(`fall_back service '${service}' is not available`);
    }

    if (!modelConfigDocument[service][model]) {
      throw new Error(`fall_back model '${model}' is not available for service '${service}'`);
    }
  }

  return true;
};

const getDefaultValuesController = async (service, model, current_configuration, type) => {
  try {
    service = service.toLowerCase();

    const getDefaultValues = (config) => {
      const default_values = {};
      const config_items = config.configuration || {};

      const isNewConfigFormat = Object.values(current_configuration).some((val) => typeof val === "object" && val !== null && "mode" in val);

      const nonWrappedKeys = ["model", "type", "is_rich_text", "prompt", "fine_tune_model", "reasoning"];

      for (const [key, value] of Object.entries(config_items)) {
        const current_value = current_configuration[key];

        if (key === "model") {
          default_values[key] = value.default || null;
          continue;
        }

        const is_mode_obj = typeof current_value === "object" && current_value !== null && "mode" in current_value;

        if (is_mode_obj || (current_value === undefined && isNewConfigFormat && !nonWrappedKeys.includes(key))) {
          // Process using { mode, value } structure
          const mode = is_mode_obj ? current_value.mode : "default";
          const val = is_mode_obj ? current_value.value : null;

          if (mode === "min") {
            default_values[key] = { mode: "min", value: null };
          } else if (mode === "max") {
            default_values[key] = { mode: "max", value: null };
          } else if (mode === "default") {
            if (type === "embedding") {
              default_values[key] = { mode: "default", value: value.default };
            } else {
              default_values[key] = { mode: "default", value: null };
            }
          } else if (mode === "custom") {
            if (key === "response_type") {
              const current_type = typeof val === "object" && val !== null ? val.type : null;
              if (current_type && value.options && value.options.some((opt) => opt.type === current_type)) {
                default_values[key] = {
                  mode: "custom",
                  value: {
                    ...val,
                    json_schema: current_type === "json_schema" ? val.json_schema || null : undefined
                  }
                };
              } else {
                default_values[key] = {
                  mode: "default",
                  value: null
                };
              }
            } else {
              const min_value = value.min;
              const max_value = value.max;
              if (min_value !== undefined && max_value !== undefined) {
                if (val !== undefined && val !== null && !(min_value <= val && val <= max_value)) {
                  default_values[key] = { mode: "custom", value: value.default || null };
                } else {
                  if (val === undefined || val === null) {
                    default_values[key] = { mode: "default", value: null };
                  } else {
                    default_values[key] = { mode: "custom", value: val };
                  }
                }
              } else {
                if (val === undefined || val === null) {
                  default_values[key] = { mode: "default", value: null };
                } else {
                  default_values[key] = { mode: "custom", value: val };
                }
              }
            }
          } else {
            default_values[key] = current_value;
          }
        } else {
          // Process using old/raw value format
          if (current_value === "min") {
            default_values[key] = "min";
          } else if (current_value === "max") {
            default_values[key] = "max";
          } else if (current_value === "default") {
            if (type === "embedding") {
              default_values[key] = value.default;
            } else {
              default_values[key] = "default";
            }
          } else {
            if (key in config_items) {
              if (key === "response_type") {
                const current_type = typeof current_value === "object" && current_value !== null ? current_value.type : null;
                if (current_type && value.options && value.options.some((opt) => opt.type === current_type)) {
                  default_values[key] = current_value;
                  if (current_type === "json_schema") {
                    default_values.response_type.json_schema = current_value.json_schema || null;
                  }
                } else {
                  default_values[key] = "default";
                }
                continue;
              }
              const min_value = value.min;
              const max_value = value.max;
              if (min_value !== undefined && max_value !== undefined) {
                if (current_value !== undefined && current_value !== null && !(min_value <= current_value && current_value <= max_value)) {
                  default_values[key] = value.default || null;
                } else {
                  if (current_value === undefined || current_value === null) {
                    default_values[key] = "default";
                  } else {
                    default_values[key] = current_value;
                  }
                }
              } else {
                if (current_value === undefined || current_value === null) {
                  default_values[key] = "default";
                } else {
                  default_values[key] = current_value;
                }
              }
            } else {
              default_values[key] = type === "embedding" ? value.default || null : "default";
            }
          }
        }
      }

      for (const [key, value] of Object.entries(current_configuration)) {
        if (!(key in default_values)) {
          default_values[key] = value;
        }
      }

      if (default_values.stream === undefined) default_values.stream = "default";
      return default_values;
    };

    if (!modelConfigDocument[service] || !modelConfigDocument[service][model]) {
      if (!modelConfigDocument[service]) {
        throw new Error(`Service '${service}' not found.`);
      }
      throw new Error(`Invalid model: ${model}`);
    }

    const modelObj = modelConfigDocument[service][model];

    if (Object.values(service_name).includes(service)) {
      return getDefaultValues(modelObj);
    } else {
      throw new Error(`Service '${service}' not found.`);
    }
  } catch (e) {
    throw new Error(e.message);
  }
};

export { validateFallBack, getDefaultValuesController };
