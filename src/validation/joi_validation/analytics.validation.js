import Joi from "joi";

/**
 * Schema for POST /api/analytics/:agent_id - getAgentAnalytics
 */
const getAgentAnalytics = {
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
  body: Joi.object()
    .keys({
      time_range: Joi.string().valid("last_24h", "last_7d", "last_30d", "custom").optional().default("last_24h"),
      start_date: Joi.date().iso().optional(),
      end_date: Joi.date().iso().min(Joi.ref("start_date")).optional(),
      tools: Joi.array().items(Joi.string()).optional(),
      latency: Joi.string().valid("any", "1", "2", "3").optional().default("any"),
      model: Joi.array().items(Joi.string()).optional(),
      service: Joi.array().items(Joi.string()).optional(),
      variables: Joi.object()
        .keys({
          mode: Joi.string().valid("with", "without").optional().default("with"),
          key: Joi.string().required(),
          value: Joi.any().optional()
        })
        .optional(),
      reviewer_failures: Joi.boolean().optional().default(false),
      error_history: Joi.boolean().optional().default(false),
      keyword: Joi.string().min(1).max(500).optional()
    })
    .unknown(true)
};

export default { getAgentAnalytics };
