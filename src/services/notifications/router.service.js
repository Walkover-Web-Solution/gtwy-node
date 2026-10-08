import notificationRuleService from "../../db_services/notificationRule.service.js";
import notificationChannelService from "../../db_services/notificationChannel.service.js";
import notificationDeliveryService from "../../db_services/notificationDelivery.service.js";
import NotificationShadowCheckModel from "../../mongoModel/NotificationShadowCheck.model.js";
import { setIfAbsentInCache } from "../../cache_service/index.js";
import { INTERNAL_ORG_ID, NOTIFICATION_EVENTS, SEVERITY_RANK, getNotificationHubMode } from "../../configs/notificationEvents.js";
import { buildWebhookBody } from "./adapters/webhook.adapter.js";
import { attemptDelivery } from "./delivery.service.js";
import { getLegacyWebhookUrls } from "./legacyAlerts.service.js";
import logger from "../../logger.js";

// Seconds between repeat sends of the same event to the same channel, when the rule sets none.
const DEFAULT_THROTTLE_SECONDS = { webhook: 0, email: 300, slack: 300 };

function ruleMatches(rule, event) {
  // Internal events reach only GTWY's internal rules, never an org's channels.
  if (event.audience === "internal" && rule.org_id !== INTERNAL_ORG_ID) return false;

  const types = rule.event_types || [];
  if (!types.includes("*") && !types.includes(event.event_type)) return false;

  if ((SEVERITY_RANK[event.severity] ?? 0) < (SEVERITY_RANK[rule.min_severity] ?? 0)) return false;

  const agents = rule.agents || [];
  if (!agents.includes("all") && !(event.agent_id && agents.includes(event.agent_id))) return false;

  if (event.event_type === "agent.metrics_limit_reached" && rule.limit != null) {
    const { metric, value } = event.data || {};
    if (rule.limit_metric && metric !== rule.limit_metric) return false;
    if (!(Number(value) >= rule.limit)) return false;
  }
  return true;
}

async function claimThrottle(rule, channel, event) {
  const seconds = rule.throttle_seconds ?? DEFAULT_THROTTLE_SECONDS[channel.kind] ?? 0;
  if (seconds <= 0) return true;
  const key = `notification_throttle_${rule._id}_${channel._id}_${event.dedupe_key || event.event_type}`;
  // Redis down (null) = send rather than silently drop.
  return (await setIfAbsentInCache(key, seconds)) !== false;
}

async function recordShadowCheck(event, hubUrls) {
  if (!NOTIFICATION_EVENTS[event.event_type]?.legacy_alert_type) return;
  const legacyUrls = await getLegacyWebhookUrls(event);
  const sorted = (urls) => [...urls].sort();
  try {
    await NotificationShadowCheckModel.create({
      event_id: event.event_id,
      event_type: event.event_type,
      org_id: event.org_id,
      agent_id: event.agent_id,
      legacy_urls: sorted(legacyUrls),
      hub_urls: sorted(hubUrls),
      match: JSON.stringify(sorted(legacyUrls)) === JSON.stringify(sorted(hubUrls))
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
}

// Sends an event to every channel its matching rules point at (or, in shadow mode, records
// what would have been sent). Safe to call again for the same event: delivery rows are unique
// per event × rule × channel.
async function routeEvent(event, notificationId = null) {
  const mode = getNotificationHubMode();
  if (mode === "off" || event.audience === "global") return { mode, deliveries: [] };

  const rules = (await notificationRuleService.getRulesForOrg(event.org_id)).filter((rule) => ruleMatches(rule, event));
  const channelIds = [...new Set(rules.flatMap((rule) => rule.channel_ids || []))];
  const channels = new Map((await notificationChannelService.getChannelsByIds(channelIds)).map((channel) => [String(channel._id), channel]));
  const payload = buildWebhookBody(event);

  const deliveries = [];
  const sends = [];
  const hubUrls = [];
  for (const rule of rules) {
    for (const channelId of rule.channel_ids || []) {
      const channel = channels.get(String(channelId));
      // A rule may only use its own org's channels.
      if (!channel || !channel.enabled || channel.org_id !== rule.org_id) continue;

      const allowed = await claimThrottle(rule, channel, event);
      const status = !allowed ? "throttled" : mode === "shadow" ? "shadow" : "sending";
      const delivery = await notificationDeliveryService.createDelivery({
        event_id: event.event_id,
        event_type: event.event_type,
        notification_id: notificationId ? String(notificationId) : null,
        org_id: event.org_id,
        agent_id: event.agent_id,
        rule_id: String(rule._id),
        channel_id: String(channel._id),
        channel_kind: channel.kind,
        internal: rule.org_id === INTERNAL_ORG_ID,
        status,
        payload
      });
      if (!delivery) continue; // already handled for this event
      deliveries.push(delivery);
      if (channel.kind === "webhook" && status !== "throttled") hubUrls.push(channel.config?.url);
      if (status === "sending") sends.push(attemptDelivery(delivery, channel));
    }
  }

  await Promise.all(sends);
  if (mode === "shadow") {
    await recordShadowCheck(event, hubUrls).catch((error) =>
      logger.error(`[NotificationRouter] shadow check failed for ${event.event_id}: ${error.message}`)
    );
  }
  return { mode, deliveries };
}

export { routeEvent, ruleMatches };
