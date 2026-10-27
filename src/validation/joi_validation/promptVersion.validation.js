import Joi from "joi";

const listPromptVersions = {
  params: Joi.object()
    .keys({
      bridge_id: Joi.string().required()
    })
    .unknown(true),
  query: Joi.object()
    .keys({
      version_id: Joi.string(),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20)
    })
    .unknown(true)
};

export default {
  listPromptVersions
};
