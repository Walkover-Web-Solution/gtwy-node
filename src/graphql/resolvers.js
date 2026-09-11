import { modelConfigDocument } from "../services/utils/loadModelConfigs.js";
import { ALL_MODEL_TYPES, transformModelConfig } from "../services/utils/modelConfigTransform.js";

// enum name <-> internal value ("fine_tune" <-> "fine-tune")
const ModelType = {
  chat: "chat",
  fine_tune: "fine-tune",
  reasoning: "reasoning",
  image: "image",
  embedding: "embedding"
};

// Flat model list for one service, optionally filtered by type.
const getServiceModels = (service_lower, typesFilter) => {
  const service_models = modelConfigDocument[service_lower];
  if (!service_models) return [];

  const typesToBuild = typesFilter && typesFilter.length ? typesFilter : ALL_MODEL_TYPES;

  const models = [];
  for (const [model_name, config] of Object.entries(service_models)) {
    if (config.status !== 1) continue;
    const type = config.validationConfig?.type || "chat";
    if (!typesToBuild.includes(type)) continue;
    models.push({ name: model_name, type, ...transformModelConfig(model_name, config) });
  }
  return models;
};

export const resolvers = {
  ModelType,

  Query: {
    services: (_parent, { names }) => {
      const serviceNames = names && names.length ? names.map((n) => n.toLowerCase()) : Object.keys(modelConfigDocument);
      return serviceNames.filter((name) => modelConfigDocument[name]).map((name) => ({ name }));
    },

    model: (_parent, { service, name }) => {
      const models = getServiceModels(service.toLowerCase(), null);
      return models.find((m) => m.name === name) || null;
    }
  },

  Service: {
    modelNames: (service, { types }) => getServiceModels(service.name, types).map((m) => m.name),
    models: (service, { types }) => getServiceModels(service.name, types)
  }
};
