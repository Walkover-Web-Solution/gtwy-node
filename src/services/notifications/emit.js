import { randomUUID } from "crypto";
import queueProducer from "../queue.service.js";
import { processEvent } from "./hub.service.js";
import logger from "../../logger.js";

const NOTIFICATION_QUEUE_NAME = process.env.NOTIFICATION_QUEUE_NAME;

function buildEnvelope({ eventType, orgId, agentId, title, message, data, severity, audience, dedupeKey }) {
  const envelope = {
    event_id: randomUUID(),
    event_type: eventType,
    org_id: orgId ?? null,
    agent_id: agentId ?? null,
    title,
    message,
    data: data || {},
    dedupe_key: dedupeKey ?? null,
    source: "node",
    occurred_at: new Date().toISOString()
  };
  if (severity) envelope.severity = severity;
  if (audience) envelope.audience = audience;
  return envelope;
}

// Publishes a notification event to the hub. Never throws: a notification must not break
// the request that raised it. If the queue is unavailable, the event is processed inline,
// since this backend is the hub.
async function emitEvent(params) {
  const envelope = buildEnvelope(params);
  try {
    if (!NOTIFICATION_QUEUE_NAME) throw new Error("NOTIFICATION_QUEUE_NAME is not set");
    await queueProducer.publishToQueue(NOTIFICATION_QUEUE_NAME, envelope);
    return true;
  } catch (publishError) {
    logger.warn(`[emitEvent] queue publish failed, processing inline: ${publishError.message}`);
    try {
      await processEvent(envelope);
      return true;
    } catch (processError) {
      logger.error(`[emitEvent] failed to process ${envelope.event_type}: ${processError.message}`);
      return false;
    }
  }
}

export { emitEvent, buildEnvelope };
