import notificationDbService from "../../db_services/notification.service.js";
import notificationValidation from "../../validation/joi_validation/notification.validation.js";
import { NOTIFICATION_EVENTS } from "../../configs/notificationEvents.js";
import { ResponseSender } from "../utils/customResponse.utils.js";
import { routeEvent } from "./router.service.js";
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

// Handles one event end to end: validate, store in the inbox once, push in-app, then route
// to outbound channels (per NOTIFICATION_HUB_MODE). A redelivered event is not stored or pushed
// again, but is routed again so a crash between storing and routing cannot lose a send;
// delivery rows are unique per event × rule × channel, so nothing is sent twice.
async function processEvent(rawEvent) {
  const event = normalizeEvent(rawEvent);
  const showInApp = event.audience !== "internal" && NOTIFICATION_EVENTS[event.event_type]?.in_app !== false;

  let notification = null;
  let duplicate = false;
  if (showInApp) {
    // The inbox keeps a lean copy: the legacy webhook body is only needed for routing.
    const inboxData = { ...(event.data || {}) };
    delete inboxData.webhook_body;
    ({ notification, duplicate } = await notificationDbService.createFromEvent({ ...event, data: inboxData }));
    if (duplicate) {
      logger.info(`[NotificationHub] duplicate event ${event.event_id}: not stored again`);
    } else {
      pushInApp(notification.toObject());
    }
  }

  const { deliveries } = await routeEvent(event, notification?._id);
  return { notification, duplicate, internal: event.audience === "internal", deliveries };
}

export { processEvent, InvalidNotificationEventError };
