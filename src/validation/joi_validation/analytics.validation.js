import Joi from "joi";

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
      range: Joi.number().integer().min(1).max(365).optional().messages({
        "number.max": "range cannot exceed 365 days"
      }),
      start_date: Joi.date().iso().optional(),
      end_date: Joi.date().iso().min(Joi.ref("start_date")).optional().messages({
        "date.min": "end_date must be after start_date"
      })
    })
    .unknown(true)
};

export default {
  getAgentAnalytics
};
