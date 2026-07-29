import ConfigurationServices from "../db_services/configuration.service.js";
import modelConfigService from "../db_services/modelConfig.service.js";

export const subscribe = async (req, res, next) => {
  const { slugName, versionId, model: reqModel, service: reqService } = req.body;

  // Direct model lookup mode — return what the model supports
  if (reqModel) {
    const modelConfigData = await modelConfigService.getModelConfigsByNameAndService(reqModel, reqService);
    const validationConfig = modelConfigData[0]?.validationConfig || {};

    const mode = [validationConfig.files && "files", validationConfig.vision && "vision"].filter(Boolean);

    res.locals = {
      mode,
      supportedEntities: mode,
      model: reqModel,
      service: reqService
    };
    req.statusCode = 200;
    return next();
  }

  // Existing agent-based lookup
  const { ispublic } = req.chatBot;
  let data = null;
  let { org } = req?.profile || {};
  let resolvedSlugName = slugName;

  if (ispublic && resolvedSlugName?.includes("::")) {
    const [orgIdFromSlug, actualSlugName] = resolvedSlugName.split("::");
    org = { ...org, id: orgIdFromSlug };
    resolvedSlugName = actualSlugName;
  }

  data = await ConfigurationServices.getAgentBySlugname(org.id, resolvedSlugName, versionId);

  if (!data || data.success === false) {
    return res.status(404).json({ error: data?.error || "Agent not found" });
  }

  const { modelConfig, service, apikey_object_id } = data;
  const model = modelConfig?.model;
  const modelConfigData = await modelConfigService.getModelConfigsByNameAndService(model, service);
  const validationConfig = modelConfigData[0]?.validationConfig || {};

  const mode = [
    validationConfig.files && "files",
    validationConfig.vision && "vision",
    modelConfig?.stream?.value === true && "stream",
    modelConfig?.response_type?.is_template && "widget",
    modelConfig?.type === "image" && "image_model"
  ].filter(Boolean);

  const supportedServices = apikey_object_id ? Object.keys(apikey_object_id) : [];

  res.locals = { mode, supportedServices };
  req.statusCode = 200;
  return next();
};
