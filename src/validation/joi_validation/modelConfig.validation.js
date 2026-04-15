import Joi from "joi";

const modelConfigSchema = Joi.object({
  service: Joi.string().valid("openai", "openai_response", "gemini", "anthropic", "groq", "open_router", "mistral", "deepgram").optional(),
  model_name: Joi.string()
    .pattern(/^[^\s]+$/)
    .message("model_name must not contain spaces")
    .required(),
  status: Joi.number().default(1),
  configuration: Joi.object().unknown(true).required(),
  outputConfig: Joi.object().unknown(true).required(),
  validationConfig: Joi.object().unknown(true).required()
}).unknown(true);

const saveUserModelConfigurationBodySchema = Joi.object({
  service: Joi.string().valid("openai", "openai_response", "gemini", "anthropic", "groq", "open_router", "mistral", "deepgram").required(),
  model_name: Joi.string()
    .pattern(/^[^\s]+$/)
    .message("model_name must not contain spaces")
    .required(),
  display_name: Joi.string().required(),
  status: Joi.number().default(1),
  configuration: Joi.object().unknown(true).required(),
  outputConfig: Joi.object().unknown(true).required(),
  validationConfig: Joi.object().unknown(true).required()
}).unknown(true);

const deleteUserModelConfigurationQuerySchema = Joi.object({
  model_name: Joi.string().required().messages({
    "any.required": "model_name is required"
  }),
  service: Joi.string().valid("openai", "openai_response", "gemini", "anthropic", "groq", "open_router", "mistral", "deepgram").required().messages({
    "any.required": "service is required"
  })
}).unknown(true);

// Legacy schema for backward compatibility
const UserModelConfigSchema = Joi.object({
  org_id: Joi.string().required(),
  service: Joi.string().valid("openai", "openai_response", "gemini", "anthropic", "groq", "open_router", "mistral", "deepgram").required(),
  model_name: Joi.string()
    .pattern(/^[^\s]+$/)
    .message("model_name must not contain spaces")
    .required(),
  display_name: Joi.string().required(),
  status: Joi.number().default(1),
  configuration: Joi.object().unknown(true).required(),
  outputConfig: Joi.object().unknown(true).required(),
  validationConfig: Joi.object().unknown(true).required()
}).unknown(true);

const setModelStatusAdminBodySchema = Joi.object({
  model_name: Joi.string().required().messages({
    "any.required": "model_name is required"
  }),
  service: Joi.string().valid("openai", "openai_response", "gemini", "anthropic", "groq", "open_router", "mistral", "deepgram").required().messages({
    "any.required": "service is required"
  }),
  status: Joi.number().valid(0, 1).required().messages({
    "any.required": "status is required",
    "any.only": "status must be 0 (disable) or 1 (enable)"
  })
});

export {
  modelConfigSchema,
  UserModelConfigSchema,
  saveUserModelConfigurationBodySchema,
  deleteUserModelConfigurationQuerySchema,
  setModelStatusAdminBodySchema
};
