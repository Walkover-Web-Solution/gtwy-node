import Joi from "joi";

const modelConfigSchema = Joi.object({
  service: Joi.string()
    .valid("openai", "openai_response", "gemini", "anthropic", "groq", "open_router", "mistral", "deepgram", "neev_cloud", "moon_shot")
    .optional(),
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
  service: Joi.string()
    .valid("openai", "openai_response", "gemini", "anthropic", "groq", "open_router", "mistral", "deepgram", "neev_cloud", "moon_shot")
    .required(),
  model_name: Joi.string()
    .pattern(/^[^\s]+$/)
    .message("model_name must not contain spaces")
    .required(),
  status: Joi.number().valid(0, 1).required(),
  configuration: Joi.object({
    model: Joi.object({
      default: Joi.string().required()
    })
      .unknown(true)
      .required()
  })
    .unknown(true)
    .required(),
  outputConfig: Joi.object().unknown(true).required(),
  validationConfig: Joi.object().unknown(true).required()
})
  .unknown(true)
  .custom((value, helpers) => {
    if (value.configuration?.model?.default !== value.model_name) {
      return helpers.message("configuration.model.default must be the same as model_name");
    }
    return value;
  }, "model_name and configuration.model.default match");

const deleteUserModelConfigurationQuerySchema = Joi.object({
  model_name: Joi.string().required().messages({
    "any.required": "model_name is required"
  }),
  service: Joi.string()
    .valid("openai", "openai_response", "gemini", "anthropic", "groq", "open_router", "mistral", "deepgram", "neev_cloud", "moon_shot")
    .required()
    .messages({
      "any.required": "service is required"
    })
}).unknown(true);

const bulkUpdateModelFilterSchema = Joi.object().min(1).unknown(true);

const bulkUpdateModelChangeSchema = Joi.object({
  status: Joi.forbidden().messages({ "any.unknown": "status cannot be updated via bulk-update API" })
}).unknown(true);

const bulkUpdateUserModelConfigurationBodySchema = Joi.object({
  models: Joi.array()
    .items(
      Joi.object({
        model_name: Joi.string()
          .pattern(/^[^\s]+$/)
          .message("model_name must not contain spaces")
          .required()
      }).required()
    )
    .min(1)
    .optional(),
  filter: bulkUpdateModelFilterSchema.optional(),
  change: bulkUpdateModelChangeSchema.required()
})
  .or("models", "filter")
  .unknown(true);

// Legacy schema for backward compatibility
const UserModelConfigSchema = Joi.object({
  org_id: Joi.string().required(),
  service: Joi.string()
    .valid("openai", "openai_response", "gemini", "anthropic", "groq", "open_router", "mistral", "deepgram", "neev_cloud", "moon_shot")
    .required(),
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
  service: Joi.string()
    .valid("openai", "openai_response", "gemini", "anthropic", "groq", "open_router", "mistral", "deepgram", "neev_cloud", "moon_shot")
    .required()
    .messages({
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
  setModelStatusAdminBodySchema,
  bulkUpdateUserModelConfigurationBodySchema
};
