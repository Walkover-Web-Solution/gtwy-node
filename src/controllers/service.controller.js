import { servicesRegistry } from "../services/utils/loadServicesRegistry.js";
import { modelConfigDocument } from "../services/utils/loadModelConfigs.js";
import { getSupportedModelSet } from "../services/utils/notDiamond.utils.js";
import serviceDbService from "../db_services/service.service.js";

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

  // service_models key order comes from DB sort (created_at desc) at load time.
  for (const [model_name, config] of Object.entries(service_models)) {
    if (config.status !== 1) continue;
    const type = config.validationConfig?.type || "chat";
    if (!result[type]) continue;

    const created_at = config.created_at || null;
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
      org_id: config.org_id,
      created_at
    };

    if (config.configuration) {
      for (const [key, value] of Object.entries(config.configuration)) {
        if (key !== "model") {
          transformedConfig.configuration.additional_parameters[key] = value;
        }
      }
    }

    result[type][model_name] = transformedConfig;
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

const addServiceController = async (req, res, next) => {
  const { service_name } = req.body;

  const exists = await serviceDbService.serviceExists(service_name);
  if (exists) {
    return res.status(409).json({ success: false, message: `Service '${service_name}' already exists` });
  }

  const result = await serviceDbService.createService(req.body);

  res.locals = {
    success: true,
    message: "Service added successfully",
    result
  };
  req.statusCode = 200;
  return next();
};

export default {
  getAllServiceModelsController,
  getAllServiceController,
  addServiceController
};
