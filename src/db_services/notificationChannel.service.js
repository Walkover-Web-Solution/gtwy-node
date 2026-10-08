import NotificationChannelModel from "../mongoModel/NotificationChannel.model.js";
import { decryptSecret, encryptSecret, maskSecret } from "../utils/notificationSecrets.utils.js";

// Channels returned by the API: secrets masked, never decrypted values.
function toPublicShape(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  const secret = obj.secret ? decryptSecret(obj.secret) : null;
  delete obj.secret;
  if (secret?.headers) {
    obj.config = {
      ...obj.config,
      headers: Object.fromEntries(Object.entries(secret.headers).map(([key, value]) => [key, maskSecret(value)]))
    };
  }
  if (secret?.webhook_url) {
    obj.config = { ...obj.config, webhook_url: maskSecret(secret.webhook_url) };
  }
  return obj;
}

// Splits API input into plain config and the encrypted secret part.
function splitConfig(kind, config = {}) {
  if (kind === "webhook") {
    const { headers, ...rest } = config;
    return { config: rest, secret: headers && Object.keys(headers).length ? encryptSecret({ headers }) : null };
  }
  if (kind === "slack") {
    const { webhook_url, ...rest } = config;
    return { config: rest, secret: webhook_url ? encryptSecret({ webhook_url }) : null };
  }
  return { config, secret: null };
}

async function createChannel({ org_id, kind, name, config, enabled = true, legacy_alert_id = null }) {
  const split = splitConfig(kind, config);
  return await new NotificationChannelModel({ org_id, kind, name, enabled, legacy_alert_id, ...split }).save();
}

async function listChannels(org_id) {
  return await NotificationChannelModel.find({ org_id }).sort({ createdAt: -1 });
}

async function getChannel(org_id, id) {
  return await NotificationChannelModel.findOne({ _id: id, org_id });
}

async function getChannelsByIds(ids) {
  if (!ids.length) return [];
  return await NotificationChannelModel.find({ _id: { $in: ids } }).lean();
}

async function updateChannel(org_id, id, { name, config, enabled }) {
  const channel = await NotificationChannelModel.findOne({ _id: id, org_id });
  if (!channel) return null;
  if (name !== undefined) channel.name = name;
  if (config !== undefined) {
    const split = splitConfig(channel.kind, config);
    channel.config = split.config;
    // Headers/URL omitted on update = keep the stored secret.
    if (split.secret) channel.secret = split.secret;
  }
  if (enabled !== undefined) {
    channel.enabled = enabled;
    if (enabled) {
      channel.consecutive_failures = 0;
      channel.disabled_reason = null;
    }
  }
  return await channel.save();
}

async function deleteChannel(org_id, id) {
  return await NotificationChannelModel.findOneAndDelete({ _id: id, org_id });
}

async function recordSuccess(id) {
  await NotificationChannelModel.updateOne({ _id: id }, { $set: { consecutive_failures: 0, last_error: null, last_success_at: new Date() } });
}

async function recordFailure(id, error) {
  return await NotificationChannelModel.findOneAndUpdate(
    { _id: id },
    { $inc: { consecutive_failures: 1 }, $set: { last_error: error } },
    { new: true }
  ).lean();
}

async function disableChannel(id, reason) {
  return await NotificationChannelModel.findOneAndUpdate(
    { _id: id, enabled: true },
    { $set: { enabled: false, disabled_reason: reason } },
    { new: true }
  ).lean();
}

export default {
  toPublicShape,
  createChannel,
  listChannels,
  getChannel,
  getChannelsByIds,
  updateChannel,
  deleteChannel,
  recordSuccess,
  recordFailure,
  disableChannel
};
