import Joi from "joi";

const validPromptIds = [
  "optimze_prompt",
  "gpt_memory",
  "structured_output_optimizer",
  "chatbot_suggestions",
  "generate_summary",
  "generate_test_cases"
];

const getPrebuiltPrompts = {
  // No validation needed
};

const updatePrebuiltPrompt = {
  body: Joi.object()
    .unknown(true)
    .custom((value, helpers) => {
      const keys = Object.keys(value);
      if (keys.length === 0) {
        return helpers.error("any.custom", { message: "Request body cannot be empty" });
      }
      if (keys.length > 1) {
        return helpers.error("any.custom", { message: "Request body must contain exactly one prompt_id" });
      }
      const prompt_id = keys[0];
      if (!validPromptIds.includes(prompt_id)) {
        return helpers.error("any.custom", {
          message: `Invalid prompt_id. Must be one of: ${validPromptIds.join(", ")}`
        });
      }
      return value;
    })
    .required()
    .messages({
      "any.custom": "{{#message}}"
    })
};

const resetPrebuiltPrompts = {
  body: Joi.object()
    .keys({
      prompt_id: Joi.string()
        .valid(...validPromptIds)
        .required()
        .messages({
          "any.required": "prompt_id is required in request body",
          "any.only": `Invalid prompt_id. Must be one of: ${validPromptIds.join(", ")}`
        })
    })
    .unknown(true)
};

const getSpecificPrebuiltPrompt = {
  params: Joi.object()
    .keys({
      prompt_key: Joi.string()
        .valid(...validPromptIds)
        .required()
        .messages({
          "any.required": "prompt_key is required",
          "any.only": `Invalid prompt_key. Must be one of: ${validPromptIds.join(", ")}`
        })
    })
    .unknown(true)
};

export default {
  getPrebuiltPrompts,
  updatePrebuiltPrompt,
  resetPrebuiltPrompts,
  getSpecificPrebuiltPrompt
};
