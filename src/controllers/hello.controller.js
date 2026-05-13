import ConfigurationServices from "../db_services/configuration.service.js";
import modelConfigService from "../db_services/modelConfig.service.js";

export const subscribe = async (req, res, next) => {
  const { ispublic } = req.chatBot;

  let data = null;
  let { slugName, versionId } = req.body;
  let { org } = req?.profile || {};

  if (ispublic && slugName?.includes("::")) {
    const [orgIdFromSlug, actualSlugName] = slugName.split("::");
    org = { ...org, id: orgIdFromSlug };
    slugName = actualSlugName;
  }

  data = await ConfigurationServices.getAgentBySlugname(org.id, slugName, versionId);

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
    modelConfig?.stream === true && "stream",
    modelConfig?.response_type?.is_template && "widget",
    modelConfig?.type === "image" && "image_model"
  ].filter(Boolean);

  const supportedServices = apikey_object_id ? Object.keys(apikey_object_id) : [];

  res.locals = { mode, supportedServices };
  req.statusCode = 200;
  return next();
};
