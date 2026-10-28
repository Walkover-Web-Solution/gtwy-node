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

const addPreTool = {
  params: Joi.object()
    .keys({
      agent_id: Joi.string().required().messages({
        "any.required": "agent_id is required"
      })
    })
    .unknown(true),
  body: Joi.object()
    .keys({
      version_id: Joi.string().optional(),
      pre_tools: Joi.object()
        .keys({
          type: Joi.string().valid("custom_function", "query_refiner", "rag_knowledgebase", "gtwy_web_search").required(),
          config: Joi.object().optional(),
          args: Joi.object().optional()
        })
        .required()
        .messages({
          "any.required": "pre_tools is required"
        }),
      status: Joi.string().valid("0", "1").required().messages({
        "any.required": "status is required",
        "any.only": 'status must be either "0" or "1"'
      })
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
  addPreTool,
  getAllInBuiltTools
};
