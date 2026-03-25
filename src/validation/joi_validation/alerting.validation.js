import Joi from "joi";
import joiObjectId from "joi-objectid";

Joi.objectId = joiObjectId(Joi);

const createAlert = {
  body: Joi.object()
    .keys({
      webhookConfiguration: Joi.object({
        url: Joi.string().uri().optional(),
        headers: Joi.object().optional()
      })
        .unknown(true)
        .required()
        .messages({
          "any.required": "webhookConfiguration is required"
        }),
      name: Joi.string().required().messages({
        "string.empty": "name is required",
        "any.required": "name is required"
      }),
      bridges: Joi.array()
        .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
        .min(1)
        .when("alertType", {
          is: Joi.array().items(Joi.string().valid("broadcast_response")),
          then: Joi.optional(),
          otherwise: Joi.required()
        })
        .messages({
          "array.min": "bridges must contain at least one bridge ID",
          "any.required": "bridges is required"
        }),
      alertType: Joi.array()
        .items(Joi.string().valid("thumbsdown", "Variable", "Error", "metrix_limit_reached", "retry_mechanism", "broadcast_response"))
        .min(1)
        .required()
        .messages({
          "array.min": "alertType must contain at least one type",
          "any.required": "alertType is required"
        }),
      limit: Joi.number().min(0).optional()
    })
    .unknown(true)
};

const getAllAlerts = {
  // No validation needed - org_id comes from middleware profile
};

const updateAlert = {
  params: Joi.object()
    .keys({
      id: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .required()
        .messages({
          "string.pattern.base": "id must be a valid MongoDB ObjectId",
          "any.required": "id is required"
        })
    })
    .unknown(true),
  body: Joi.object()
    .keys({
      webhookConfiguration: Joi.object({
        url: Joi.string().uri().optional(),
        headers: Joi.object().optional()
      })
        .unknown(true)
        .optional(),
      bridges: Joi.array()
        .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
        .optional(),
      name: Joi.string().optional(),
      alertType: Joi.array()
        .items(Joi.string().valid("thumbsdown", "Variable", "Error", "metrix_limit_reached", "retry_mechanism", "broadcast_response"))
        .optional()
    })
    .unknown(true)
};

const deleteAlert = {
  body: Joi.object()
    .keys({
      id: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .required()
        .messages({
          "string.pattern.base": "id must be a valid MongoDB ObjectId",
          "any.required": "id is required"
        })
    })
    .unknown(true)
};

export default {
  createAlert,
  getAllAlerts,
  updateAlert,
  deleteAlert
};
