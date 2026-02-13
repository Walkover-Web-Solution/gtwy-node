import Joi from "joi";

const saveApikey = {
  body: Joi.object()
    .keys({
      name: Joi.string().required(),
      apikey: Joi.string().required(),
      service: Joi.string().valid("openai", "gemini", "anthropic", "groq", "open_router", "mistral", "ai_ml", "grok").required(),
      comment: Joi.string().allow("").optional(),
      apikey_limit: Joi.number().min(0).precision(6).optional(),
      apikey_usage: Joi.number().min(0).precision(6).optional(),
      apikey_limit_reset_period: Joi.string().valid("monthly", "weekly", "daily").optional(),
      apikey_limit_start_date: Joi.date().optional()
    })
    .unknown(true)
};

const getAllApikeys = {
  // No validation needed
};

const updateApikey = {
  params: Joi.object()
    .keys({
      apikey_id: Joi.string()
        .regex(/^[0-9a-fA-F]{24}$/)
        .required()
        .messages({
          "string.pattern.base": "apikey_id must be a valid MongoDB ObjectId",
          "any.required": "apikey_id is required"
        })
    })
    .unknown(true),
  body: Joi.object()
    .keys({
      name: Joi.string().optional(),
      apikey: Joi.string().optional(),
      service: Joi.string().valid("openai", "gemini", "anthropic", "groq", "open_router", "mistral", "ai_ml", "grok").optional(),
      comment: Joi.string().allow("").optional(),
      apikey_limit: Joi.number().min(0).precision(6).optional(),
      apikey_usage: Joi.number().min(0).precision(6).optional(),
      apikey_limit_reset_period: Joi.string().valid("monthly", "weekly", "daily").optional(),
      apikey_limit_start_date: Joi.date().optional()
    })
    .unknown(true)
};

const deleteApikey = {
  body: Joi.object()
    .keys({
      apikey_object_id: Joi.string()
        .regex(/^[0-9a-fA-F]{24}$/)
        .required()
        .messages({
          "string.pattern.base": "apikey_object_id must be a valid MongoDB ObjectId",
          "any.required": "apikey_object_id is required"
        })
    })
    .unknown(true)
};

export default {
  saveApikey,
  getAllApikeys,
  updateApikey,
  deleteApikey
};
