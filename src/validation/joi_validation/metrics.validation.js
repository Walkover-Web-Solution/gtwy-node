import Joi from "joi";

const idSchema = Joi.alternatives().try(Joi.number().integer(), Joi.string().trim().min(1));
const idFilterSchema = Joi.alternatives().try(idSchema, Joi.array().items(idSchema));

/**
 * Schema for POST /metrics - get_metrics_data
 * Validates request body and query parameters
 */
const getMetricsData = {
  query: Joi.object()
    .keys({
      startTime: Joi.string().optional(),
      endTime: Joi.string().optional()
    })
    .unknown(true),
  body: Joi.object()
    .keys({
      apikey_id: idFilterSchema.optional(),
      service: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).optional(),
      model: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).optional(),
      thread_id: idFilterSchema.optional(),
      bridge_id: idFilterSchema.optional(),
      version_id: idFilterSchema.optional(),
      range: Joi.number().integer().required().messages({
        "any.required": "range is required",
        "number.base": "range must be a number"
      }),
      factor: Joi.string().required().messages({
        "any.required": "factor is required",
        "string.base": "factor must be a string"
      }),
      start_date: Joi.date().optional(),
      end_date: Joi.date().optional()
    })
    .unknown(true)
};

/**
 * Schema for POST /metrics/user - get_user_metrics
 */
const getUserMetrics = {
  body: Joi.object()
    .keys({
      user_id: idFilterSchema.required().messages({
        "any.required": "user_id is required"
      }),
      start_date: Joi.date().required().messages({
        "any.required": "start_date is required"
      }),
      end_date: Joi.date().required().messages({
        "any.required": "end_date is required"
      })
    })
    .unknown(true)
};

export default {
  getMetricsData,
  getUserMetrics
};
