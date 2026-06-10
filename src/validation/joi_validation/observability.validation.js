import Joi from "joi";

const createLog = {
  body: Joi.object()
    .keys({
      log_id: Joi.string().trim().min(1).required().messages({
        "string.empty": "log_id cannot be empty",
        "any.required": "log_id is required"
      }),
      data: Joi.alternatives().try(Joi.object().unknown(true), Joi.array()).required().messages({
        "alternatives.types": "data must be an object or an array",
        "any.required": "data is required"
      })
    })
    .unknown(true)
};

const getLogs = {
  params: Joi.object()
    .keys({
      log_id: Joi.string().trim().min(1).required().messages({
        "string.empty": "log_id cannot be empty",
        "any.required": "log_id is required"
      })
    })
    .unknown(true),
  // No defaults on page/pageSize: their absence (along with search) selects the
  // legacy unpaginated response in the controller.
  query: Joi.object()
    .keys({
      search: Joi.alternatives()
        .try(
          Joi.string().trim().min(1).max(256).messages({
            "string.empty": "search cannot be empty",
            "string.max": "search cannot exceed 256 characters"
          }),
          Joi.object().min(1).max(1).pattern(Joi.string().min(1).max(256), Joi.string().min(1).max(256)).messages({
            "object.min": "search object must have exactly one key",
            "object.max": "search object must have exactly one key"
          })
        )
        .optional(),
      page: Joi.number().integer().min(1).optional(),
      pageSize: Joi.number().integer().min(1).max(100).optional().messages({
        "number.max": "pageSize cannot exceed 100"
      })
    })
    .unknown(true)
};

const listLogs = {
  query: Joi.object()
    .keys({
      log_id: Joi.string().trim().min(1).optional(),
      page: Joi.number().integer().min(1).default(1),
      pageSize: Joi.number().integer().min(1).max(100).default(50).messages({
        "number.max": "pageSize cannot exceed 100"
      })
    })
    .unknown(true)
};

export default {
  createLog,
  getLogs,
  listLogs
};
