import Joi from "joi";

// A multi-select string filter: either one string (possibly comma-separated, split
// in the controller) or an array of strings from bracket-style query params.
const multiString = Joi.alternatives().try(Joi.array().items(Joi.string().trim().min(1)), Joi.string().trim().min(1));

const getAgentAnalytics = {
  params: Joi.object()
    .keys({
      bridge_id: Joi.string().trim().min(1).required().messages({
        "string.empty": "bridge_id cannot be empty",
        "any.required": "bridge_id is required"
      })
    })
    .unknown(true),
  query: Joi.object()
    .keys({
      range: Joi.alternatives()
        .try(Joi.number().integer().min(1).max(365), Joi.string().pattern(/^[0-9]+[hd]$/))
        .optional()
        .messages({
          "number.max": "range cannot exceed 365 days",
          "string.pattern.base": "range must be a valid format like '1h' or '24h'"
        }),
      interval: Joi.string()
        .pattern(/^[0-9]+[hd]$/)
        .optional()
        .messages({
          "string.pattern.base": "interval must be a valid format like '1h' or '24h'"
        }),
      start_date: Joi.date().iso().optional(),
      end_date: Joi.date().iso().min(Joi.ref("start_date")).optional().messages({
        "date.min": "end_date must be after start_date"
      }),
      // tool_id / model / service are multi-select: accept a single string
      // (optionally comma-separated) or an array of strings (e.g. tool_id[]=a&tool_id[]=b).
      tool_id: multiString.optional(),
      model: multiString.optional(),
      service: multiString.optional(),
      user_feedback: Joi.string().valid("good", "bad", "all").optional().default("all"),
      error: Joi.string().valid("true", "false").optional(),
      version_id: Joi.string().trim().min(1).optional(),
      testcase_id: Joi.string().trim().min(1).optional(),
      keyword: Joi.string().min(1).max(500).optional(),
      message_id: Joi.string().trim().min(1).optional(),
      filter_by: Joi.object().unknown(true).optional(),
      page: Joi.number().integer().min(1).optional().default(1),
      page_size: Joi.number().integer().min(1).max(100).optional().default(20)
    })
    .unknown(true)
};

const getAgentAnalyticsFilters = {
  params: Joi.object()
    .keys({
      bridge_id: Joi.string().trim().min(1).required().messages({
        "string.empty": "bridge_id cannot be empty",
        "any.required": "bridge_id is required"
      })
    })
    .unknown(true)
};

export default {
  getAgentAnalytics,
  getAgentAnalyticsFilters
};
