import { randomUUID } from "crypto";
import notificationDbService from "../db_services/notification.service.js";
import { processEvent } from "../services/notifications/hub.service.js";
import { NOTIFICATION_EVENTS } from "../configs/notificationEvents.js";

// HTTP producers call the hub directly (not through the queue) so the response can
// carry the stored notification.
async function createNotification(req, res, next) {
  const org_id = req.profile.org.id;
  const { event_type, agent_id, severity, title, message, data } = req.body;

  const { notification } = await processEvent({
    event_id: randomUUID(),
    event_type,
    audience: "org",
    severity,
    org_id,
    agent_id,
    title,
    message,
    data,
    source: "api"
  });

  res.locals = {
    success: true,
    message: "Notification created successfully",
    data: notification
  };
  req.statusCode = 201;
  return next();
}

async function broadcastNotification(req, res, next) {
  // Deliberately does not read req.profile.org.id — this is a global broadcast to
  // every org, not scoped to whoever is calling it. Auth is InternalAuth-only.
  const { severity, title, message, data } = req.body;

  const { notification } = await processEvent({
    event_id: randomUUID(),
    event_type: "system.announcement",
    audience: "global",
    severity,
    title,
    message,
    data,
    source: "api"
  });

  res.locals = {
    success: true,
    message: "Notification broadcast to all organizations",
    data: notification
  };
  req.statusCode = 201;
  return next();
}

// Publishes a full event envelope (InternalAuth only), for admin tools and scripts.
async function publishEvent(req, res, next) {
  const result = await processEvent({ source: "api", ...req.body, event_id: req.body.event_id || randomUUID() });

  res.locals = {
    success: true,
    message: result.duplicate ? "Event already processed" : "Event processed",
    data: result.notification,
    duplicate: result.duplicate,
    internal: result.internal
  };
  req.statusCode = result.duplicate ? 200 : 201;
  return next();
}

async function getCatalogue(req, res, next) {
  const events = Object.entries(NOTIFICATION_EVENTS)
    .filter(([, event]) => event.audience !== "internal" && event.in_app !== false)
    .map(([event_type, event]) => ({
      event_type,
      label: event.label,
      description: event.description,
      audience: event.audience,
      severity: event.severity
    }));

  res.locals = { success: true, data: events };
  req.statusCode = 200;
  return next();
}

async function getNotifications(req, res, next) {
  const org_id = req.profile.org.id;
  const user_id = req.profile.user.id;
  const { agent_id, scope, unread, severity, event_type, page, limit } = req.query;

  const result = await notificationDbService.getNotifications({
    org_id,
    agent_id,
    scope,
    user_id,
    unread: unread === true || unread === "true",
    severity,
    event_type,
    page: page ? Number(page) : 1,
    limit: limit ? Number(limit) : 20
  });

  res.locals = {
    success: true,
    ...result
  };
  req.statusCode = 200;
  return next();
}

async function markAsRead(req, res, next) {
  const org_id = req.profile.org.id;
  const user_id = req.profile.user.id;
  const { id } = req.params;

  const result = await notificationDbService.markAsRead({ id, user_id, org_id });

  if (result.error === "notFound") {
    res.locals = { success: false, message: "Notification not found" };
    req.statusCode = 404;
    return next();
  }

  res.locals = { success: true, data: result.data };
  req.statusCode = 200;
  return next();
}

async function markAllAsRead(req, res, next) {
  const org_id = req.profile.org.id;
  const user_id = req.profile.user.id;
  const { agent_id, scope } = req.body;

  const result = await notificationDbService.markAllAsRead({ org_id, agent_id, scope, user_id });

  res.locals = {
    success: true,
    message: "Notifications marked as read",
    modifiedCount: result.modifiedCount
  };
  req.statusCode = 200;
  return next();
}

export default {
  createNotification,
  broadcastNotification,
  publishEvent,
  getCatalogue,
  getNotifications,
  markAsRead,
  markAllAsRead
};
