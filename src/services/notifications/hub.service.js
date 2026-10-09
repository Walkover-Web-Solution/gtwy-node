import notificationDbService from "../../db_services/notification.service.js";
import notificationValidation from "../../validation/joi_validation/notification.validation.js";
import { NOTIFICATION_EVENTS } from "../../configs/notificationEvents.js";
import { ResponseSender } from "../utils/customResponse.utils.js";
import { dispatchEvent, hostOf } from "./dispatch.service.js";
import logger from "../../logger.js";

const responseSender = new ResponseSender();

class InvalidNotificationEventError extends Error {}

// Fills audience and severity from the catalogue, then validates the envelope.
function normalizeEvent(rawEvent) {
  const catalogueEntry = NOTIFICATION_EVENTS[rawEvent?.event_type];
  // Undefined fields (e.g. an omitted severity) must not override the catalogue defaults.
  const provided = Object.fromEntries(Object.entries(rawEvent || {}).filter(([, value]) => value !== undefined));
  const withDefaults = catalogueEntry
    ? {
        audience: catalogueEntry.audience,
        severity: catalogueEntry.severity,
        ...provided
      }
    : provided;

  const { value, error } = notificationValidation.eventEnvelope.validate(withDefaults, { abortEarly: false });
  if (error) {
    throw new InvalidNotificationEventError(error.details.map((detail) => detail.message).join(", "));
  }

  return {
    ...value,
    org_id: value.audience === "global" || value.org_id == null ? null : String(value.org_id),
    agent_id: value.agent_id ? String(value.agent_id) : null,
    occurred_at: value.occurred_at || new Date()
  };
}

// Org and agent notifications go to the org channel, which every page of the dashboard
// listens on (the bell shows all of them); global broadcasts go to the channel every client hears.
function getRtChannel(notification) {
  if (notification.audience === "global") return "global_updates";
  return `org_${notification.org_id}`;
}

function pushInApp(notification) {
  responseSender
    .sendResponse({
      rtlLayer: true,
      data: { type: "notification", notification },
      reqBody: { rtlOptions: { channel: getRtChannel(notification), ttl: 30, apikey: process.env.RTLAYER_AUTH } },
      headers: {}
    })
    .catch((err) => logger.error(`[NotificationHub] RTLayer push failed: ${err.message}`));
}

// Alerts-section type names as people read them, for the failure message.
const ALERT_TYPE_LABELS = {
  Error: "error",
  Variable: "missing-variables",
  retry_mechanism: "retry",
  thumbsdown: "thumbs-down",
  broadcast_response: "response broadcast",
  metrix_limit_reached: "metrics-limit"
};

// A customer webhook from the Alerts section that failed is itself shown in-app.
async function reportWebhookFailure(event, { alert, alertType, url, failure }) {
  await processEvent({
    event_id: `${event.event_id}:webhook:${alert._id}`,
    event_type: "alert.webhook_failed",
    org_id: event.org_id,
    agent_id: event.agent_id,
    title: `Alert "${alert.name || "webhook"}" could not be delivered`,
    message: `Sending the ${ALERT_TYPE_LABELS[alertType] || alertType} alert to ${hostOf(url)} failed: ${failure}`,
    data: { alert_type: alertType, webhook_host: hostOf(url), error: failure },
    dedupe_key: `alert.webhook_failed:${alert._id}`,
    source: "hub"
  }).catch((error) => logger.error(`[NotificationHub] could not record webhook failure: ${error.message}`));
}

// Handles one event end to end: store the in-app copy (unless the event is internal or
// webhook-only), push it, then send it everywhere else it belongs (dispatchEvent). A repeat of
// the same alert within a few minutes is merged into one notification with a count. A
// redelivered event (same event_id) is neither stored nor sent again.
async function processEvent(rawEvent) {
  const event = normalizeEvent(rawEvent);
  const inApp = event.audience !== "internal" && NOTIFICATION_EVENTS[event.event_type]?.in_app !== false;

  let notification = null;
  let duplicate = false;
  let merged = false;
  if (inApp) {
    // The inbox keeps a lean copy; the bodies are only needed for sending.
    const inboxData = { ...(event.data || {}) };
    ["webhook_body", "team_body", "team_route", "mail_body", "legacy_alert_type"].forEach((key) => delete inboxData[key]);
    ({ notification, duplicate, merged } = await notificationDbService.createFromEvent({ ...event, data: inboxData }));
    if (duplicate) {
      logger.info(`[NotificationHub] duplicate event ${event.event_id}: not stored or sent again`);
      return { notification: null, duplicate: true, merged: false, internal: false };
    }
    pushInApp(notification.toObject ? notification.toObject() : notification);
  }

  await dispatchEvent(event, (failure) => reportWebhookFailure(event, failure));
  return { notification, duplicate, merged, internal: event.audience === "internal" };
}

export { processEvent, InvalidNotificationEventError };
