import { servicesRegistry } from "../services/utils/loadServicesRegistry.js";
import { modelConfigDocument } from "../services/utils/loadModelConfigs.js";
import { getSupportedModelSet } from "../services/utils/notDiamond.utils.js";
import serviceDbService from "../db_services/service.service.js";

/** Resolve model creation time from created_at or Mongo ObjectId. */
function resolveModelCreatedAt(config) {
  if (config?.created_at) {
    const ms = new Date(config.created_at).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  if (config?.createdAt) {
    const ms = new Date(config.createdAt).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  const id = config?._id;
  if (!id) return 0;
  if (typeof id.getTimestamp === "function") {
    return id.getTimestamp().getTime();
  }
  const hex = String(id);
  if (/^[a-fA-F0-9]{24}$/.test(hex)) {
    return parseInt(hex.slice(0, 8), 16) * 1000;
  }
  return 0;
}

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
  const modelsByType = { chat: [], "fine-tune": [], reasoning: [], image: [], embedding: [] };

  for (const [model_name, config] of Object.entries(service_models)) {
    if (config.status !== 1) continue;
    const type = config.validationConfig?.type || "chat";
    if (!modelsByType[type]) continue;

    const createdAtMs = resolveModelCreatedAt(config);
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
      org_id: config.org_id,
      created_at: createdAtMs ? new Date(createdAtMs).toISOString() : null
    };

    // Move all other configuration fields to additional_parameters
    if (config.configuration) {
      for (const [key, value] of Object.entries(config.configuration)) {
        if (key !== "model") {
          transformedConfig.configuration.additional_parameters[key] = value;
        }
      }
    }

    modelsByType[type].push({ model_name, createdAtMs, transformedConfig });
  }

  // Latest models first within each type (Object key insertion order is preserved).
  for (const type of Object.keys(modelsByType)) {
    modelsByType[type]
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .forEach(({ model_name, transformedConfig }) => {
        result[type][model_name] = transformedConfig;
      });
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
