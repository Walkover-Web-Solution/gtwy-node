import Joi from "joi";
import joiObjectId from "joi-objectid";

Joi.objectId = joiObjectId(Joi);

/**
 * Schema for GET /:bridge_id/:thread_id/:sub_thread_id - getConversationLogs
 * Validates URL params and query params
 */
const getConversationLogs = {
  params: Joi.object()
    .keys({
      agent_id: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .required()
        .messages({
          "string.pattern.base": "agent_id must be a valid MongoDB ObjectId",
          "any.required": "agent_id is required"
        }),
      thread_id: Joi.string().required().messages({
        "string.empty": "thread_id is required",
        "any.required": "thread_id is required"
      }),
      sub_thread_id: Joi.string().required().messages({
        "string.empty": "sub_thread_id is required",
        "any.required": "sub_thread_id is required"
      })
    })
    .unknown(true),
  query: Joi.object()
    .keys({
      page: Joi.number().integer().min(1).optional().default(1).messages({
        "number.base": "Page must be a number",
        "number.integer": "Page must be an integer",
        "number.min": "Page must be a positive integer"
      }),
      limit: Joi.number().integer().min(1).max(100).optional().default(30).messages({
        "number.base": "Limit must be a number",
        "number.integer": "Limit must be an integer",
        "number.min": "Limit must be at least 1",
        "number.max": "Limit must be at most 100"
      }),
      user_feedback: Joi.string().optional().default("all"),
      error: Joi.string().optional().default("false")
    })
    .unknown(true)
};

/**
 * Schema for GET /threads/:bridge_id - getRecentThreads
 * Validates URL params and query params
 */
const getRecentThreads = {
  params: Joi.object()
    .keys({
      agent_id: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .required()
        .messages({
          "string.pattern.base": "agent_id must be a valid MongoDB ObjectId",
          "any.required": "agent_id is required"
        })
    })
    .unknown(true),
  query: Joi.object()
    .keys({
      page: Joi.number().integer().min(1).optional().default(1).messages({
        "number.base": "Page must be a number",
        "number.integer": "Page must be an integer",
        "number.min": "Page must be a positive integer"
      }),
      limit: Joi.number().integer().min(1).max(100).optional().default(30).messages({
        "number.base": "Limit must be a number",
        "number.integer": "Limit must be an integer",
        "number.min": "Limit must be at least 1",
        "number.max": "Limit must be at most 100"
      }),
      user_feedback: Joi.string().valid("all", "0", "1", "2").optional().default("all").messages({
        "string.base": "user_feedback must be a string",
        "any.only": "user_feedback must be one of: all, 0, 1, 2"
      }),
      error: Joi.string().valid("true", "false").optional().default("false").messages({
        "string.base": "error must be a string",
        "any.only": 'error must be either "true" or "false"'
      }),
      version_id: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .optional()
        .messages({
          "string.pattern.base": "version_id must be a valid MongoDB ObjectId"
        }),
      keyword: Joi.string().min(1).max(500).optional().messages({
        "string.base": "keyword must be a string",
        "string.min": "keyword must be at least 1 character long",
        "string.max": "keyword must be at most 500 characters long"
      }),
      start_date: Joi.date().iso().optional().messages({
        "date.base": "start_date must be a valid date",
        "date.format": "start_date must be in ISO format"
      }),
      end_date: Joi.date().iso().min(Joi.ref("start_date")).optional().messages({
        "date.base": "end_date must be a valid date",
        "date.format": "end_date must be in ISO format",
        "date.min": "end_date must be after start_date"
      })
    })
    .unknown(true)
};

/**
 * Schema for GET /:agent_id/:thread_id/:message_id - getRecursiveAgentHistory
 * Validates URL params for recursive agent history
 */
const getRecursiveAgentHistory = {
  params: Joi.object()
    .keys({
      agent_id: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .required()
        .messages({
          "string.pattern.base": "agent_id must be a valid MongoDB ObjectId",
          "any.required": "agent_id is required"
        }),
      thread_id: Joi.string().required().messages({
        "string.empty": "thread_id is required",
        "any.required": "thread_id is required"
      }),
      message_id: Joi.string().required().messages({
        "string.empty": "message_id is required",
        "any.required": "message_id is required"
      })
    })
    .unknown(true)
};

/**
 * Schema for GET /batch/history/:agent_id - getBatchConversationLogs
 * Validates URL params and query params for batch
 */
const getBatchConversationLogs = {
  params: Joi.object()
    .keys({
      agent_id: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .required()
        .messages({
          "string.pattern.base": "agent_id must be a valid MongoDB ObjectId",
          "any.required": "agent_id is required"
        })
    })
    .unknown(true),
  query: Joi.object()
    .keys({
      page: Joi.number().integer().min(1).optional().default(1).messages({
        "number.base": "Page must be a number",
        "number.integer": "Page must be an integer",
        "number.min": "Page must be a positive integer"
      }),
      limit: Joi.number().integer().min(1).max(100).optional().default(30).messages({
        "number.base": "Limit must be a number",
        "number.integer": "Limit must be an integer",
        "number.min": "Limit must be at least 1",
        "number.max": "Limit must be at most 100"
      }),
      filter: Joi.string().valid("completed", "queued", "processing").optional().messages({
        "any.only": "filter must be one of: completed, queued, processing"
      })
    })
    .unknown(true)
};
const getBatchConversationCountLogs = {
  params: Joi.object().keys({
    agent_id: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required()
      .messages({
        "string.pattern.base": "agent_id must be a valid MongoDB ObjectId",
        "any.required": "agent_id is required"
      })
  })
};

export default {
  getConversationLogs,
  getRecentThreads,
  getRecursiveAgentHistory,
  getBatchConversationLogs,
  getBatchConversationCountLogs
};
