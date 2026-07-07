import Joi from "joi";

const FUNCTION_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const FUNCTION_NAME_MESSAGE = "title must contain only letters, numbers, underscores, or hyphens (no spaces or special characters)";

const getAllApiCalls = {
  // No validation needed
};

const updateApiCalls = {
  params: Joi.object()
    .keys({
      function_id: Joi.string().required().messages({
        "any.required": "function_id is required"
      })
    })
    .unknown(true),
  body: Joi.object()
    .keys({
      dataToSend: Joi.object()
        .keys({
          title: Joi.string().pattern(FUNCTION_NAME_PATTERN).optional().messages({
            "string.pattern.base": FUNCTION_NAME_MESSAGE
          })
        })
        .unknown(true)
        .required()
        .messages({
          "any.required": "dataToSend is required"
        })
    })
    .unknown(true)
};

const deleteFunction = {
  body: Joi.object()
    .keys({
      script_id: Joi.string().required().messages({
        "any.required": "script_id is required"
      })
    })
    .unknown(true)
};

const createApi = {
  body: Joi.object()
    .keys({
      id: Joi.string().required().messages({
        "any.required": "id (script_id) is required"
      }),
      title: Joi.string().pattern(FUNCTION_NAME_PATTERN).optional().messages({
        "string.pattern.base": FUNCTION_NAME_MESSAGE
      }),
      desc: Joi.string().required().messages({
        "any.required": "desc is required"
      }),
      status: Joi.string().valid("published", "updated", "delete", "paused").required().messages({
        "any.required": "status is required",
        "any.only": "status must be one of: published, updated, delete, paused"
      }),
      payload: Joi.object().optional()
    })
    .unknown(true)
};

const getAllInBuiltTools = {
  // No validation needed
};

export default {
  getAllApiCalls,
  updateApiCalls,
  deleteFunction,
  createApi,
  getAllInBuiltTools
};
