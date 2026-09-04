import Joi from "joi";

const idSchema = Joi.alternatives().try(Joi.number().integer(), Joi.string().trim().min(1));
const multiIdSchema = Joi.alternatives().try(idSchema, Joi.array().items(idSchema).min(1));
const multiStringSchema = Joi.alternatives().try(Joi.string().trim().min(1), Joi.array().items(Joi.string().trim().min(1)).min(1));

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
      apikey_id: multiIdSchema.optional(),
      service: multiStringSchema.optional(),
      model: multiStringSchema.optional(),
      thread_id: idSchema.optional(),
      bridge_id: multiIdSchema.optional(),
      version_id: idSchema.optional(),
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

const getRequestsActivity = {
  body: Joi.object()
    .keys({
      bridge_id: multiIdSchema.optional(),
      model: multiStringSchema.optional(),
      service: multiStringSchema.optional(),
      range: Joi.number().integer().optional(),
      start_date: Joi.date().optional(),
      end_date: Joi.date().optional()
    })
    .unknown(true)
};

export default {
  getMetricsData,
  getRequestsActivity
};
