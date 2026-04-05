import modelConfigDbService from "../db_services/modelConfig.service.js";
import { validateModel } from "../services/utils/modelValidation.utils.js";
import ConfigurationServices from "../db_services/configuration.service.js";

async function saveUserModelConfiguration(req, res, next) {
  const { model_name, service, status, configuration, outputConfig, validationConfig } = req.body;

  // check models validity and support
  const isModelSupported = await validateModel(service, model_name);

  if (!isModelSupported) {
    throw new Error(`Model '${model_name}' is not supported by service '${service}'`);
  }

  // Check if model with same service and model_name already exists for this org
  const modelExists = await modelConfigDbService.checkModelConfigExists(service, model_name);
  if (modelExists) {
    throw new Error(`Model configuration with service '${service}' and model_name '${model_name}' already exists`);
  }

  const result = await modelConfigDbService.saveModelConfig({
    service,
    model_name,
    status,
    configuration,
    outputConfig,
    validationConfig
  });
  res.locals = {
    success: true,
    message: `Model configuration saved successfully`,
    result
  };
  req.statusCode = 200;
  return next();
}

async function deleteUserModelConfiguration(req, res, next) {
  const { model_name, service } = req.query;
  const org_id = req.profile.org.id;

  const usageCheck = await ConfigurationServices.findIdsByModelAndService(model_name, service, org_id);

  if (usageCheck.success && (usageCheck.data.agents.length > 0 || usageCheck.data.versions.length > 0)) {
    // Model is in use, return error with details
    return res.status(409).json({
      success: false,
      error: "Cannot delete model configuration as it is currently in use",
      usageDetails: usageCheck.data
    });
  }

  const result = await modelConfigDbService.deleteUserModelConfig(model_name, service, org_id);

  if (!result) {
    return res.status(404).json({ success: false, message: "Model configuration not found." });
  }

  res.locals = {
    success: true,
    message: `Model configuration '${model_name}' for service '${service}' deleted successfully.`
  };
  req.statusCode = 200;
  return next();
}

export { saveUserModelConfiguration, deleteUserModelConfiguration };
