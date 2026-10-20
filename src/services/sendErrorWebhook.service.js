import logger from "../logger.js";
import { emitEvent } from "./notifications/emit.js";

// Thumbs-down feedback goes to the notification hub, which shows it in-app and sends it to the
// webhooks subscribed to "thumbsdown" in the Alerts section (body unchanged from before).
async function send_error_to_webhook(bridge_id, org_id, error_log, error_type) {
  try {
    if (error_type !== "thumbsdown") {
      throw new Error("Invalid error type");
    }
    const payload = {
      details: thumbs_down_error(error_log),
      bridge_id,
      org_id
    };

    await emitEvent({
      eventType: "agent.thumbs_down",
      orgId: org_id,
      agentId: bridge_id,
      title: "Response rated thumbs down",
      message: typeof error_log === "string" && error_log ? error_log.slice(0, 500) : "A user rated an agent response thumbs down",
      data: {
        legacy_alert_type: "thumbsdown",
        webhook_body: { response: { data: payload }, variables: {} }
      },
      dedupeKey: `agent.thumbs_down:${bridge_id}`
    });
  } catch (error) {
    logger.error(`Error in send_error_to_webhook: ${error.message}`);
  }
}

function thumbs_down_error(details) {
  return {
    alert: "Thumbs down on response",
    Variables: details
  };
}

export { send_error_to_webhook };
