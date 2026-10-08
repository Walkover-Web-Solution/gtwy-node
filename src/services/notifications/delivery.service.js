import notificationDeliveryService from "../../db_services/notificationDelivery.service.js";
import notificationChannelService from "../../db_services/notificationChannel.service.js";
import { INTERNAL_ORG_ID } from "../../configs/notificationEvents.js";
import { decryptSecret } from "../../utils/notificationSecrets.utils.js";
import { sendWebhook } from "./adapters/webhook.adapter.js";
import logger from "../../logger.js";

const MAX_CONSECUTIVE_FAILURES = 20;

async function sendToChannel(channel, payload) {
  const secret = decryptSecret(channel.secret) || {};
  switch (channel.kind) {
    case "webhook":
      return await sendWebhook({ url: channel.config?.url, headers: secret.headers || {}, body: payload });
    default:
      // Email and Slack adapters arrive in Phase 3.
      return { ok: false, status: null, error: `${channel.kind} channels are not supported yet`, terminal: true };
  }
}

async function handleChannelFailure(channel, error) {
  const updated = await notificationChannelService.recordFailure(channel._id, error);
  if (!updated || updated.consecutive_failures < MAX_CONSECUTIVE_FAILURES) return;

  const reason = `Disabled after ${MAX_CONSECUTIVE_FAILURES} failed deliveries in a row. Last error: ${error}`;
  const disabled = await notificationChannelService.disableChannel(channel._id, reason);
  if (!disabled || disabled.org_id === INTERNAL_ORG_ID) return;

  // Imported lazily: emit → hub → router → this module.
  const { emitEvent } = await import("./emit.js");
  await emitEvent({
    eventType: "channel.disabled",
    orgId: disabled.org_id,
    title: `Notification channel "${disabled.name}" was disabled`,
    message: reason,
    data: { channel_id: String(disabled._id), channel_kind: disabled.kind },
    dedupeKey: `channel.disabled:${disabled._id}`
  });
}

// Sends one delivery row and records the outcome. Never throws.
async function attemptDelivery(delivery, channel) {
  try {
    const target = channel || (await notificationChannelService.getChannelsByIds([delivery.channel_id]))[0];
    if (!target || !target.enabled) {
      await notificationDeliveryService.markFailed(delivery._id, "Channel was deleted or disabled");
      return;
    }

    const result = await sendToChannel(target, delivery.payload);
    if (result.ok) {
      await Promise.all([notificationDeliveryService.markSent(delivery._id, result.status), notificationChannelService.recordSuccess(target._id)]);
      return;
    }

    if (result.terminal) {
      await notificationDeliveryService.markFailed(delivery._id, result.error);
      return;
    }
    await notificationDeliveryService.markAttemptFailed(delivery._id, { response_code: result.status, error: result.error });
    await handleChannelFailure(target, result.error);
  } catch (error) {
    logger.error(`[NotificationDelivery] ${delivery?._id} failed unexpectedly: ${error.message}`);
  }
}

// Retry worker body: sends deliveries whose next_retry_at has passed.
async function processDueDeliveries(maxPerRun = 200) {
  await notificationDeliveryService.releaseStaleClaims();
  let processed = 0;
  while (processed < maxPerRun) {
    const delivery = await notificationDeliveryService.claimDueDelivery();
    if (!delivery) break;
    await attemptDelivery(delivery);
    processed++;
  }
  return processed;
}

export { attemptDelivery, processDueDeliveries };
