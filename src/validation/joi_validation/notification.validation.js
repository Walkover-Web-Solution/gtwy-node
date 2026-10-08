import Joi from "joi";
import { NOTIFICATION_AUDIENCES, NOTIFICATION_EVENTS, NOTIFICATION_EVENT_TYPES, NOTIFICATION_SEVERITIES } from "../../configs/notificationEvents.js";

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
    .when("audience", { is: "global", then: Joi.optional(), otherwise: Joi.required() }),
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

const objectIdSchema = Joi.string()
  .pattern(/^[0-9a-fA-F]{24}$/)
  .messages({ "string.pattern.base": "must be a valid MongoDB ObjectId" });

const idParam = {
  params: Joi.object().keys({ id: objectIdSchema.required() }).unknown(true)
};

// Customers can subscribe to any non-internal event, or "*" for all of them.
const SUBSCRIBABLE_EVENT_TYPES = NOTIFICATION_EVENT_TYPES.filter((type) => NOTIFICATION_EVENTS[type].audience !== "internal");

const webhookConfigSchema = Joi.object({
  url: Joi.string().uri({ scheme: ["http", "https"] }),
  headers: Joi.object().pattern(Joi.string(), Joi.string())
});

const createChannel = {
  body: Joi.object().keys({
    kind: Joi.string().valid("webhook").required().messages({
      "any.only": "only webhook channels are supported for now; email and Slack are coming"
    }),
    name: Joi.string().trim().max(100).required(),
    config: webhookConfigSchema
      .keys({
        url: Joi.string()
          .uri({ scheme: ["http", "https"] })
          .required()
      })
      .required(),
    enabled: Joi.boolean().optional()
  })
};

const updateChannel = {
  ...idParam,
  body: Joi.object()
    .keys({
      name: Joi.string().trim().max(100),
      config: webhookConfigSchema,
      enabled: Joi.boolean()
    })
    .min(1)
};

const ruleFields = {
  name: Joi.string().trim().max(100),
  event_types: Joi.array()
    .items(Joi.string().valid("*", ...SUBSCRIBABLE_EVENT_TYPES))
    .min(1)
    .unique(),
  min_severity: severitySchema,
  agents: Joi.array().items(Joi.string()).min(1).unique(),
  channel_ids: Joi.array().items(objectIdSchema).min(1).unique(),
  throttle_seconds: Joi.number().integer().min(0).max(86400).allow(null),
  limit: Joi.number().min(0).allow(null),
  limit_metric: Joi.string().valid("cost", "tokens", "requests").allow(null),
  enabled: Joi.boolean()
};

const createRule = {
  body: Joi.object().keys({
    ...ruleFields,
    name: ruleFields.name.required(),
    event_types: ruleFields.event_types.required(),
    channel_ids: ruleFields.channel_ids.required()
  })
};

const updateRule = {
  ...idParam,
  body: Joi.object().keys(ruleFields).min(1)
};

const listDeliveries = {
  query: Joi.object().keys({
    channel_id: objectIdSchema,
    rule_id: objectIdSchema,
    status: Joi.string().valid("pending", "sending", "sent", "failed", "throttled", "shadow"),
    from: Joi.date().iso(),
    to: Joi.date().iso(),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100)
  })
};

const shadowParity = {
  query: Joi.object().keys({
    days: Joi.number().integer().min(1).max(30)
  })
};

export default {
  idParam,
  createChannel,
  updateChannel,
  createRule,
  updateRule,
  listDeliveries,
  shadowParity,
  eventEnvelope,
  createNotification,
  broadcastNotification,
  publishEvent,
  getNotifications,
  markAsRead,
  markAllAsRead
};
