// Model-config reshaping used by the /graphql resolvers.

export const ALL_MODEL_TYPES = ["chat", "fine-tune", "reasoning", "image", "embedding"];

// Reshapes one raw modelConfigDocument entry into the public config shape.
export const transformModelConfig = (model_name, config) => {
  const transformedConfig = {
    configuration: {
      model: config.configuration?.model || {
        field: "drop",
        default: model_name,
        level: 1
      },
      additional_parameters: {}
    },
    validationConfig: config.validationConfig,
    outputConfig: config.outputConfig,
    org_id: config.org_id
  };

  // rest goes to additional_parameters
  if (config.configuration) {
    for (const [key, value] of Object.entries(config.configuration)) {
      if (key !== "model") {
        transformedConfig.configuration.additional_parameters[key] = value;
      }
    }
  }

  return transformedConfig;
};
