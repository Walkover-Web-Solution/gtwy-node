import Joi from "joi";
import joiObjectId from "joi-objectid";

Joi.objectId = joiObjectId(Joi);

const embedLogin = {
  // No validation needed - uses GtwyEmbeddecodeToken middleware
};

const createEmbed = {
  body: Joi.object()
    .keys({
      name: Joi.string().required().messages({
        "string.empty": "name is required",
        "any.required": "name is required"
      }),
      config: Joi.object().optional().default({}),
      apikey_object_id: Joi.object()
        .pattern(Joi.string(), Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
        .optional()
        .default({}),
      folder_limit: Joi.number().min(0).optional().default(0),
      type: Joi.string().valid("embed", "rag_embed").optional().default("embed")
    })
    .unknown(true)
};

const getAllEmbed = {
  // No validation needed
};

const updateEmbed = {
  body: Joi.object()
    .keys({
      folder_id: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .required()
        .messages({
          "string.pattern.base": "folder_id must be a valid MongoDB ObjectId",
          "any.required": "folder_id is required"
        }),
      config: Joi.object().optional(),
      apikey_object_id: Joi.object()
        .pattern(Joi.string(), Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
        .optional(),
      folder_limit: Joi.number().min(0).optional(),
      folder_usage: Joi.number().min(0).optional()
    })
    .unknown(true)
};

const genrateToken = {
  // No validation needed
};

const getEmbedDataByUserId = {
  query: Joi.object()
    .keys({
      agent_id: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .optional()
        .messages({
          "string.pattern.base": "agent_id must be a valid MongoDB ObjectId"
        })
    })
    .unknown(true)
};

const updateAgentMetadata = {
  body: Joi.object()
    .keys({
      meta: Joi.object().required().messages({
        "any.required": "meta is required"
      })
    })
    .unknown(false)
};

const updateAgentMetadata = {
  body: Joi.object()
    .keys({
      meta: Joi.object().required().messages({
        "any.required": "meta is required",
      }),
    })
    .unknown(false),
}

export default {
  embedLogin,
  createEmbed,
  getAllEmbed,
  updateEmbed,
  genrateToken,
  getEmbedDataByUserId,
  updateAgentMetadata
};
