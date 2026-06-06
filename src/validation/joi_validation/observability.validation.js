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
    .unknown(true)
};

export default {
  createLog,
  getLogs
};
