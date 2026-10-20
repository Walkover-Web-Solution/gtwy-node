import AlertModel from "../../mongoModel/Alerting.model.js";
import { emitEvent } from "../notifications/emit.js";
import logger from "../../logger.js";

// Forwards an agent response to the webhooks subscribed to "broadcast_response" in the Alerts
// section, through the notification hub. Runs for every response, so it only emits when the org
// has such a webhook at all.
async function broadcastResponseWebhook({ bridge_id, org_id, response, user_question, variables, error_type }) {
  try {
    if (!(await AlertModel.exists({ org_id, alertType: error_type }))) return;

    await emitEvent({
      eventType: "agent.response_broadcast",
      orgId: org_id,
      agentId: bridge_id,
      title: "Agent response broadcast",
      message: "An agent response was forwarded to webhooks",
      data: {
        legacy_alert_type: error_type,
        webhook_body: {
          response: { response: response || {}, user_question: user_question || "", variables: variables || {} },
          variables: variables || {}
        }
      }
    });
  } catch (err) {
    logger.error(`Error in broadcastResponseWebhook: ${err.message}`);
  }
}

export { broadcastResponseWebhook };
