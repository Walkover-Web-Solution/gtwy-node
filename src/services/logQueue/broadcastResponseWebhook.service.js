import { get_webhook_data } from "../../db_services/webhookAlert.service.js";
import { sendResponse } from "../utils/utility.service.js";
import logger from "../../logger.js";
import { emitEvent } from "../notifications/emit.js";
import { ruleMatches } from "../notifications/router.service.js";
import notificationRuleService from "../../db_services/notificationRule.service.js";
import { getNotificationHubMode, LEGACY_ALERT_TYPE_TO_EVENT } from "../../configs/notificationEvents.js";

async function broadcastResponseWebhook({ bridge_id, org_id, response, user_question, variables, error_type }) {
  try {
    // Notification hub: shadow = also emit (old path still sends), on = hub sends instead.
    const hubMode = getNotificationHubMode();
    if (hubMode !== "off") {
      const legacyType = LEGACY_ALERT_TYPE_TO_EVENT[error_type];
      // This runs for every agent response, so only emit when some rule would use it.
      const probe = { event_type: legacyType, audience: "org", severity: "info", agent_id: bridge_id, data: {} };
      const wanted = legacyType && (await notificationRuleService.getRulesForOrg(org_id)).some((rule) => ruleMatches(rule, probe));
      if (wanted) {
        await emitEvent({
          eventType: legacyType,
          orgId: org_id,
          agentId: bridge_id,
          title: "Agent response broadcast",
          message: "An agent response was forwarded to webhooks",
          data: {
            webhook_body: {
              response: { response: response || {}, user_question: user_question || "", variables: variables || {} },
              variables: variables || {}
            }
          }
        });
      }
    }
    if (hubMode === "on") return;

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
