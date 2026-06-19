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

    const eligible = webhook_data.filter((entry) => {
      const bridges = entry.bridges || [];
      const alert_types = entry.alertType || [];
      if (!alert_types.includes(error_type)) return false;
      if (!bridges.includes(bridge_id) && !bridges.includes("all")) return false;
      if (!entry.webhookConfiguration?.url) {
        logger.warn(`Missing webhook URL for entry: ${entry.name || "unnamed"}`);
        return false;
      }
      return true;
    });

    const broadcast_data = {
      response: response || {},
      user_question: user_question || "",
      variables: variables || {}
    };

    await Promise.all(
      eligible.map((entry) => {
        const { url, headers = {} } = entry.webhookConfiguration;
        return sendResponse({ type: "webhook", cred: { url, headers } }, broadcast_data, variables || {});
      })
    );
  } catch (err) {
    logger.error(`Error in broadcastResponseWebhook: ${err.message}`);
  }
}

export { broadcastResponseWebhook };
