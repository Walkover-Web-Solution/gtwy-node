import { servicesRegistry } from "../services/utils/loadServicesRegistry.js";
import { modelConfigDocument } from "../services/utils/loadModelConfigs.js";
import { getSupportedModelSet } from "../services/utils/notDiamond.utils.js";

const getAllServiceModelsController = async (req, res, next) => {
  const { service } = req.params;
  const service_lower = service.toLowerCase();

  if (!modelConfigDocument[service_lower]) {
    res.locals = {};
    req.statusCode = 200;
    return next();
  }

  const result = { chat: {}, "fine-tune": {}, reasoning: {}, image: {}, embedding: {} };
  const service_models = modelConfigDocument[service_lower];

  for (const [model_name, config] of Object.entries(service_models)) {
    if (config.status !== 1) continue;
    const type = config.validationConfig?.type || "chat";
    if (result[type]) {
      // Transform config to desired format
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

      // Move all other configuration fields to additional_parameters
      if (config.configuration) {
        for (const [key, value] of Object.entries(config.configuration)) {
          if (key !== "model") {
            transformedConfig.configuration.additional_parameters[key] = value;
          }
        }
      }

      result[type][model_name] = transformedConfig;
    }
  }

  res.locals = result;
  req.statusCode = 200;
  return next();
};

const getAllServiceController = async (req, res, next) => {
  const supportedModelSet = await getSupportedModelSet();

  const serviceNames = Object.keys(servicesRegistry);
  const services = {};
  for (const service of serviceNames) {
    const serviceModels = Object.keys(modelConfigDocument[service] || {});
    const autoRouterSupport = serviceModels.some((model) => supportedModelSet.has(`${service}:${model}`));
    const svc = servicesRegistry[service];
    const displayName = svc.service_name
      ? svc.service_name
          .split(/[_-]/)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ")
      : service;
    services[service] = {
      model: svc.default_model,
      default_fallback_model: svc.default_model,
      default_name: displayName,
      autoRouterSupport
    };
  }

  res.locals = {
    success: true,
    message: "Get all service successfully",
    services
  };
  req.statusCode = 200;
  return next();
};

export default {
  getAllServiceModelsController,
  getAllServiceController
};
