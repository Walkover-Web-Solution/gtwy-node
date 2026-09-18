import Joi from "joi";

const createNotification = {
  body: Joi.object()
    .keys({
      agent_id: Joi.string().optional().allow(null),
      type: Joi.string().required().messages({
        "any.required": "type is required"
      }),
      title: Joi.string().required().messages({
        "any.required": "title is required"
      }),
      message: Joi.string().required().messages({
        "any.required": "message is required"
      }),
      data: Joi.object().unknown(true).optional()
    })
    .unknown(true)
};

const broadcastNotification = {
  body: Joi.object()
    .keys({
      type: Joi.string().required().messages({
        "any.required": "type is required"
      }),
      title: Joi.string().required().messages({
        "any.required": "title is required"
      }),
      message: Joi.string().required().messages({
        "any.required": "message is required"
      }),
      data: Joi.object().unknown(true).optional()
    })
    .unknown(true)
};

const getNotifications = {
  query: Joi.object()
    .keys({
      agent_id: Joi.string().optional(),
      scope: Joi.string().valid("org").optional(),
      page: Joi.number().integer().min(1).optional(),
      limit: Joi.number().integer().min(1).max(100).optional()
    })
    .unknown(true)
};

const markAsRead = {
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
    .unknown(true)
};

const markAllAsRead = {
  body: Joi.object()
    .keys({
      agent_id: Joi.string().optional()
    })
    .unknown(true)
};

export default {
  createNotification,
  broadcastNotification,
  getNotifications,
  markAsRead,
  markAllAsRead
};
