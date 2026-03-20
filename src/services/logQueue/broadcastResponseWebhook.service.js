import { get_webhook_data } from "../../db_services/webhookAlert.service.js";
import { sendResponse } from "../utils/utility.service.js";
import logger from "../../logger.js";

async function broadcastResponseWebhook({ bridge_id, org_id, response, user_question, variables, error_type }) {
  try {
    const result = await get_webhook_data(org_id);
    if (!result?.webhook_data) return;

    const webhook_data = [...result.webhook_data];

    webhook_data.push({
      org_id,
      name: "default alert",
      webhookConfiguration: { url: "https://flow.sokt.io/func/scriSmH2QaBH", headers: {} },
      alertType: ["Error", "Variable", "retry_mechanism"],
      bridges: ["all"]
    });

    for (const entry of webhook_data) {
      const bridges = entry.bridges || [];
      const alert_types = entry.alertType || [];

      if (!alert_types.includes(error_type)) continue;
      if (!bridges.includes(bridge_id) && !bridges.includes("all")) continue;

      const webhook_config = entry.webhookConfiguration;
      const webhook_url = entry.user_url || webhook_config?.url;
      const headers = webhook_config?.headers || {};

      const response_format = { type: "webhook", cred: { url: webhook_url, headers } };

      const broadcast_data = {
        response: response || {},
        user_question: user_question || "",
        variables: variables || {}
      };

      await sendResponse(response_format, broadcast_data, variables || {});
    }
  } catch (err) {
    logger.error(`Error in broadcastResponseWebhook: ${err.message}`);
  }
}

export { broadcastResponseWebhook };
