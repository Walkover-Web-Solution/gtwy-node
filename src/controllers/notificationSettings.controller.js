import { randomUUID } from "crypto";
import notificationChannelService from "../db_services/notificationChannel.service.js";
import notificationRuleService from "../db_services/notificationRule.service.js";
import notificationDeliveryService from "../db_services/notificationDelivery.service.js";
import NotificationChannelModel from "../mongoModel/NotificationChannel.model.js";
import NotificationShadowCheckModel from "../mongoModel/NotificationShadowCheck.model.js";
import { attemptDelivery } from "../services/notifications/delivery.service.js";
import { buildWebhookBody, sendWebhook } from "../services/notifications/adapters/webhook.adapter.js";
import { decryptSecret } from "../utils/notificationSecrets.utils.js";

const notFound = (req, res, next, what) => {
  res.locals = { success: false, message: `${what} not found` };
  req.statusCode = 404;
  return next();
};

// ---------- channels ----------

async function listChannels(req, res, next) {
  const channels = await notificationChannelService.listChannels(req.profile.org.id);
  res.locals = { success: true, data: channels.map(notificationChannelService.toPublicShape) };
  req.statusCode = 200;
  return next();
}

async function createChannel(req, res, next) {
  const channel = await notificationChannelService.createChannel({ org_id: req.profile.org.id, ...req.body });
  res.locals = { success: true, data: notificationChannelService.toPublicShape(channel) };
  req.statusCode = 201;
  return next();
}

async function updateChannel(req, res, next) {
  const channel = await notificationChannelService.updateChannel(req.profile.org.id, req.params.id, req.body);
  if (!channel) return notFound(req, res, next, "Channel");
  await notificationRuleService.invalidateRules(req.profile.org.id);
  res.locals = { success: true, data: notificationChannelService.toPublicShape(channel) };
  req.statusCode = 200;
  return next();
}

async function deleteChannel(req, res, next) {
  const org_id = req.profile.org.id;
  const channel = await notificationChannelService.deleteChannel(org_id, req.params.id);
  if (!channel) return notFound(req, res, next, "Channel");
  await notificationRuleService.removeChannelFromRules(org_id, String(channel._id));
  res.locals = { success: true, message: "Channel deleted" };
  req.statusCode = 200;
  return next();
}

// Sends a sample event straight to one channel; nothing is stored.
async function testChannel(req, res, next) {
  const channel = await notificationChannelService.getChannel(req.profile.org.id, req.params.id);
  if (!channel) return notFound(req, res, next, "Channel");
  const body = buildWebhookBody({
    event_id: randomUUID(),
    event_type: "system.announcement",
    severity: "info",
    title: "Test notification",
    message: `This is a test from GTWY for the channel "${channel.name}".`,
    org_id: channel.org_id,
    agent_id: null,
    data: { test: true },
    occurred_at: new Date().toISOString()
  });
  const secret = decryptSecret(channel.secret) || {};
  const result = await sendWebhook({ url: channel.config?.url, headers: secret.headers || {}, body });
  res.locals = { success: result.ok, data: { status: result.status, error: result.error } };
  req.statusCode = 200;
  return next();
}

// ---------- rules ----------

// Rules may only point at the org's own channels.
async function findForeignChannelIds(org_id, channel_ids = []) {
  if (!channel_ids.length) return [];
  const owned = await NotificationChannelModel.find({ _id: { $in: channel_ids }, org_id }, { _id: 1 }).lean();
  const ownedIds = new Set(owned.map((channel) => String(channel._id)));
  return channel_ids.filter((id) => !ownedIds.has(id));
}

async function rejectForeignChannels(req, res, next) {
  const foreign = await findForeignChannelIds(req.profile.org.id, req.body.channel_ids);
  if (!foreign.length) return false;
  res.locals = { success: false, message: `Unknown channel ids: ${foreign.join(", ")}` };
  req.statusCode = 400;
  next();
  return true;
}

async function listRules(req, res, next) {
  res.locals = { success: true, data: await notificationRuleService.listRules(req.profile.org.id) };
  req.statusCode = 200;
  return next();
}

async function createRule(req, res, next) {
  if (await rejectForeignChannels(req, res, next)) return;
  const rule = await notificationRuleService.createRule({ org_id: req.profile.org.id, ...req.body });
  res.locals = { success: true, data: rule };
  req.statusCode = 201;
  return next();
}

async function updateRule(req, res, next) {
  if (await rejectForeignChannels(req, res, next)) return;
  const rule = await notificationRuleService.updateRule(req.profile.org.id, req.params.id, req.body);
  if (!rule) return notFound(req, res, next, "Rule");
  res.locals = { success: true, data: rule };
  req.statusCode = 200;
  return next();
}

async function deleteRule(req, res, next) {
  const rule = await notificationRuleService.deleteRule(req.profile.org.id, req.params.id);
  if (!rule) return notFound(req, res, next, "Rule");
  res.locals = { success: true, message: "Rule deleted" };
  req.statusCode = 200;
  return next();
}

// ---------- deliveries ----------

async function listDeliveries(req, res, next) {
  const { page, limit, ...filters } = req.query;
  const result = await notificationDeliveryService.listDeliveries({
    org_id: req.profile.org.id,
    ...filters,
    page: page ? Number(page) : 1,
    limit: limit ? Number(limit) : 50
  });
  res.locals = { success: true, ...result };
  req.statusCode = 200;
  return next();
}

async function retryDelivery(req, res, next) {
  const delivery = await notificationDeliveryService.requeueDelivery(req.profile.org.id, req.params.id);
  if (!delivery) return notFound(req, res, next, "Failed or pending delivery");
  await attemptDelivery(delivery);
  res.locals = { success: true, message: "Retry sent" };
  req.statusCode = 200;
  return next();
}

// ---------- shadow mode (GTWY internal) ----------

async function getShadowParity(req, res, next) {
  const days = req.query.days ? Number(req.query.days) : 7;
  const since = new Date(Date.now() - days * 86_400_000);
  const [total, mismatched, samples] = await Promise.all([
    NotificationShadowCheckModel.countDocuments({ createdAt: { $gte: since } }),
    NotificationShadowCheckModel.countDocuments({ createdAt: { $gte: since }, match: false }),
    NotificationShadowCheckModel.find({ createdAt: { $gte: since }, match: false })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean()
  ]);
  res.locals = {
    success: true,
    data: { days, total, matched: total - mismatched, mismatched, parity: total === 0 ? null : (total - mismatched) / total, samples }
  };
  req.statusCode = 200;
  return next();
}

export default {
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  testChannel,
  listRules,
  createRule,
  updateRule,
  deleteRule,
  listDeliveries,
  retryDelivery,
  getShadowParity
};
