import { get_webhook_data } from "../db_services/webhookAlert.service.js";
import { sendResponse } from "./utils/utility.service.js";
import logger from "../logger.js";
import { emitEvent } from "./notifications/emit.js";
import { getNotificationHubMode } from "../configs/notificationEvents.js";

async function send_error_to_webhook(bridge_id, org_id, error_log, error_type) {
  try {
    if (error_type !== "thumbsdown") {
      throw new Error("Invalid error type");
    }
    const details_payload = thumbs_down_error(error_log);

    // Notification hub: shadow = also emit (old path still sends), on = hub sends instead.
    const hubMode = getNotificationHubMode();
    if (hubMode !== "off") {
      await emitEvent({
        eventType: "agent.thumbs_down",
        orgId: org_id,
        agentId: bridge_id,
        title: "Response rated thumbs down",
        message: typeof error_log === "string" ? error_log.slice(0, 500) : "A user rated an agent response thumbs down",
        data: {
          // Exactly what the legacy path posts, so webhook receivers see no change.
          webhook_body: { response: { data: { details: details_payload, bridge_id, org_id } }, variables: {} }
        }
      });
    }
    if (hubMode === "on") return;

    // Fetch webhook data for the organization
    const result = await get_webhook_data(org_id);
    if (!result || !result.webhook_data) {
      throw new Error("Webhook data is missing in the response.");
    }

    let webhook_data = result.webhook_data;

    // Iterate through webhook configurations and send responses
    for (const entry of webhook_data) {
      const webhook_config = entry.webhookConfiguration;
      const bridges = entry.bridges || ["all"];

      if (entry.alertType.includes(error_type) && (bridges.includes(bridge_id) || bridges.includes("all"))) {
        const webhook_url = webhook_config.url;
        const headers = webhook_config.headers || {};

        // Prepare details for the webhook
        const payload = {
          details: details_payload,
          bridge_id,
          org_id
        };

        // Send the response
        const response_format = create_response_format(webhook_url, headers);
        await sendResponse(response_format, { data: payload });
      }
    }
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

function create_response_format(url, headers) {
  return {
    type: "webhook",
    cred: {
      url: url,
      headers: headers
    }
  };
}

export { send_error_to_webhook };
