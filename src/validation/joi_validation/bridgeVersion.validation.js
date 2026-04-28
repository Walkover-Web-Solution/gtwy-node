import Joi from "joi";

const createVersion = {
  body: Joi.object()
    .keys({
      version_id: Joi.string().required(),
      version_description: Joi.string().optional().allow("")
    })
    .unknown(true)
};

const getVersion = {
  params: Joi.object()
    .keys({
      version_id: Joi.string().required()
    })
    .unknown(true)
};

const publishVersion = {
  params: Joi.object()
    .keys({
      version_id: Joi.string().required()
    })
    .unknown(true)
};

const removeVersion = {
  params: Joi.object()
    .keys({
      version_id: Joi.string().required()
    })
    .unknown(true)
};

const bulkPublishVersion = {
  body: Joi.object()
    .keys({
      version_ids: Joi.array().items(Joi.string().required()).min(1).required()
    })
    .unknown(true)
};

const discardVersion = {
  params: Joi.object()
    .keys({
      version_id: Joi.string().required()
    })
    .unknown(true)
};

const suggestModel = {
  params: Joi.object()
    .keys({
      version_id: Joi.string().required()
    })
    .unknown(true)
};

const getConnectedAgents = {
  params: Joi.object()
    .keys({
      version_id: Joi.string().required()
    })
    .unknown(true),
  query: Joi.object()
    .keys({
      type: Joi.string().optional(),
      key: Joi.string().valid("orchestral", "flow").optional().default("orchestral")
    })
    .unknown(true)
};

export default {
  createVersion,
  getVersion,
  publishVersion,
  removeVersion,
  bulkPublishVersion,
  discardVersion,
  suggestModel,
  getConnectedAgents
};
