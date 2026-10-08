import AlertModel from "../../mongoModel/Alerting.model.js";
import NotificationChannelModel from "../../mongoModel/NotificationChannel.model.js";
import NotificationRuleModel from "../../mongoModel/NotificationRule.model.js";
import notificationRuleService from "../../db_services/notificationRule.service.js";
import { NOTIFICATION_EVENTS } from "../../configs/notificationEvents.js";
import { buildDocsFromAlert, LEGACY_DEFAULT_ALERT } from "./legacyAlertMapping.js";
import logger from "../../logger.js";

// Keeps the channel + rule for one Alert in step with it. Called after every
// /api/alerting write while both systems run side by side.
async function syncLegacyAlert(alert) {
  try {
    const { channel, rule } = buildDocsFromAlert(alert.toObject ? alert.toObject() : alert);
    const savedChannel = await NotificationChannelModel.findOneAndUpdate(
      { legacy_alert_id: channel.legacy_alert_id },
      { $set: channel },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await NotificationRuleModel.findOneAndUpdate(
      { legacy_alert_id: rule.legacy_alert_id },
      { $set: { ...rule, channel_ids: [String(savedChannel._id)] } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await notificationRuleService.invalidateRules(rule.org_id);
  } catch (error) {
    logger.error(`[legacyAlerts] sync failed for alert ${alert?._id}: ${error.message}`);
  }
}

async function removeLegacyAlert(alertId, org_id) {
  try {
    const legacy_alert_id = String(alertId);
    await Promise.all([NotificationChannelModel.deleteOne({ legacy_alert_id }), NotificationRuleModel.deleteOne({ legacy_alert_id })]);
    if (org_id) await notificationRuleService.invalidateRules(String(org_id));
  } catch (error) {
    logger.error(`[legacyAlerts] remove failed for alert ${alertId}: ${error.message}`);
  }
}

// The webhook URLs the old alert path sends this event to — the shadow-mode baseline.
async function getLegacyWebhookUrls(event) {
  const legacyType = NOTIFICATION_EVENTS[event.event_type]?.legacy_alert_type;
  if (!legacyType || !event.org_id) return [];
  const alerts = await AlertModel.find({ org_id: event.org_id, alertType: legacyType }).lean();
  const urls = alerts
    .filter((alert) => {
      const bridges = alert.bridges || [];
      return bridges.includes("all") || (event.agent_id && bridges.includes(event.agent_id));
    })
    .map((alert) => alert.webhookConfiguration?.url)
    .filter(Boolean);
  // Only the Python producer appends the default alert.
  if (event.source === "python" && LEGACY_DEFAULT_ALERT.alert_types.includes(legacyType)) {
    urls.push(LEGACY_DEFAULT_ALERT.url);
  }
  return urls;
}

export { syncLegacyAlert, removeLegacyAlert, getLegacyWebhookUrls };
