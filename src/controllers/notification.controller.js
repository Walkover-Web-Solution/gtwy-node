import notificationDbService from "../db_services/notification.service.js";
import { ResponseSender } from "../services/utils/customResponse.utils.js";

const responseSender = new ResponseSender();

async function createNotification(req, res, next) {
  const org_id = req.profile.org.id;
  const { agent_id, type, title, message, data } = req.body;

  const notification = await notificationDbService.createNotification({
    org_id,
    agent_id,
    type,
    title,
    message,
    data
  });

  // Mutually exclusive: an agent-scoped notification goes only to that agent's channel
  // (so it's not shown while viewing other agents); an org-wide one goes only to the org channel.
  const rtChannel = agent_id ? `${org_id}_${agent_id}`.replace(/ /g, "_") : `org_${org_id}`;
  responseSender
    .sendResponse({
      rtlLayer: true,
      data: { type: "notification", notification },
      reqBody: { rtlOptions: { channel: rtChannel, ttl: 30, apikey: process.env.RTLAYER_AUTH } },
      headers: {}
    })
    .catch((err) => console.error("Error pushing notification via RTLayer:", err));

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
  const { type, title, message, data } = req.body;

  const notification = await notificationDbService.broadcastNotification({ type, title, message, data });

  responseSender
    .sendResponse({
      rtlLayer: true,
      data: { type: "notification", notification },
      reqBody: { rtlOptions: { channel: "global_updates", ttl: 30, apikey: process.env.RTLAYER_AUTH } },
      headers: {}
    })
    .catch((err) => console.error("Error broadcasting notification via RTLayer:", err));

  res.locals = {
    success: true,
    message: "Notification broadcast to all organizations",
    data: notification
  };
  req.statusCode = 201;
  return next();
}

async function getNotifications(req, res, next) {
  const org_id = req.profile.org.id;
  const user_id = req.profile.user.id;
  const { agent_id, scope, page, limit } = req.query;

  const result = await notificationDbService.getNotifications({
    org_id,
    agent_id,
    scope,
    user_id,
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
  const { agent_id } = req.body;

  const result = await notificationDbService.markAllAsRead({ org_id, agent_id, user_id });

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
  getNotifications,
  markAsRead,
  markAllAsRead
};
