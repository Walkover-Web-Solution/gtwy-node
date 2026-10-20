import Joi from "joi";
import { NOTIFICATION_AUDIENCES, NOTIFICATION_EVENT_TYPES, NOTIFICATION_SEVERITIES } from "../../configs/notificationEvents.js";

const eventTypeSchema = Joi.string()
  .valid(...NOTIFICATION_EVENT_TYPES)
  .messages({ "any.only": "event_type must be one of the notification catalogue events" });

const severitySchema = Joi.string().valid(...NOTIFICATION_SEVERITIES);

// The event envelope every producer publishes. Defaults for audience and severity
// come from the catalogue and are filled in by the hub before validation.
const eventEnvelope = Joi.object({
  event_id: Joi.string().required(),
  event_type: eventTypeSchema.required(),
  audience: Joi.string()
    .valid(...NOTIFICATION_AUDIENCES)
    .optional(),
  severity: severitySchema.optional(),
  org_id: Joi.alternatives()
    .try(Joi.string(), Joi.number())
    .allow(null)
    .when("audience", { is: "org", then: Joi.required(), otherwise: Joi.optional() }),
  agent_id: Joi.string().allow(null).optional(),
  title: Joi.string().required(),
  message: Joi.string().required(),
  data: Joi.object().unknown(true).default({}),
  dedupe_key: Joi.string().allow(null).optional(),
  source: Joi.string().optional(),
  occurred_at: Joi.date().iso().optional()
}).unknown(true);

const createNotification = {
  body: Joi.object()
    .keys({
      event_type: eventTypeSchema.required().messages({
        "any.required": "event_type is required"
      }),
      agent_id: Joi.string().optional().allow(null),
      severity: severitySchema.optional(),
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
      severity: severitySchema.optional(),
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

const publishEvent = {
  body: eventEnvelope.keys({ event_id: Joi.string().optional() })
};

const getNotifications = {
  query: Joi.object()
    .keys({
      agent_id: Joi.string().optional(),
      scope: Joi.string().valid("org").optional(),
      unread: Joi.boolean().optional(),
      severity: severitySchema.optional(),
      event_type: eventTypeSchema.optional(),
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
      agent_id: Joi.string().optional(),
      scope: Joi.string().valid("all").optional()
    })
    .unknown(true)
};

export default {
  eventEnvelope,
  createNotification,
  broadcastNotification,
  publishEvent,
  getNotifications,
  markAsRead,
  markAllAsRead
};
