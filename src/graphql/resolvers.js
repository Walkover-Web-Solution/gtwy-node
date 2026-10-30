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

// Flat model list for one service, optionally filtered by type. Models the
// embed folder marks as hidden (context.folderModels) are left out.
const getServiceModels = (service_lower, typesFilter, folderModels = {}) => {
  const service_models = modelConfigDocument[service_lower];
  if (!service_models) return [];

  const typesToBuild = typesFilter && typesFilter.length ? typesFilter : ALL_MODEL_TYPES;
  const hiddenModels = folderModels[service_lower] || {};

  const models = [];
  for (const [model_name, config] of Object.entries(service_models)) {
    if (config.status !== 1) continue;
    if (hiddenModels[model_name]?.hide === true) continue;
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

    model: (_parent, { service, name }, { folderModels }) => {
      const models = getServiceModels(service.toLowerCase(), null, folderModels);
      return models.find((m) => m.name === name) || null;
    }
  },

  Service: {
    modelNames: (service, { types }, { folderModels }) => getServiceModels(service.name, types, folderModels).map((m) => m.name),
    models: (service, { types }, { folderModels }) => getServiceModels(service.name, types, folderModels)
  }
};
