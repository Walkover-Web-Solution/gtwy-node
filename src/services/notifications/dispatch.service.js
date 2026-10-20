import AlertModel from "../../mongoModel/Alerting.model.js";
import { NOTIFICATION_EVENTS } from "../../configs/notificationEvents.js";
import logger from "../../logger.js";

// Where alerts go besides the in-app inbox. Customer webhooks come from the Alerts section
// (the alerts collection); GTWY team and email endpoints are fixed here, overridable by env.
const TEAM_ALERT_URL = process.env.NOTIFICATION_TEAM_ALERT_URL || "https://flow.sokt.io/func/scriYP8m551q";
const TEAM_OPS_URL = process.env.NOTIFICATION_TEAM_OPS_URL || "https://flow.sokt.io/func/scrimCFAKPWg";
const USAGE_MAIL_URL = process.env.NOTIFICATION_USAGE_MAIL_URL || "https://flow.sokt.io/func/scrikY1L98L6";

const WEBHOOK_TIMEOUT_MS = 10_000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [1_000, 2_000];

// Customer alerts that the GTWY team also receives (the old "default alert" of send_alert.py).
const TEAM_COPY_ALERT_TYPES = new Set(["Error", "Variable", "retry_mechanism"]);

// POSTs JSON with a short retry for gateway errors and dropped connections, like the old senders.
// Never throws: returns null when delivered, or why it failed.
async function postJson(url, body, headers = {}) {
  for (let attempt = 0; ; attempt++) {
    let failure;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
      });
      if (response.ok) return null;
      failure = `HTTP ${response.status}`;
      if (!RETRYABLE_STATUS.has(response.status)) return failure;
    } catch (error) {
      failure = error?.name === "TimeoutError" ? `timed out after ${WEBHOOK_TIMEOUT_MS / 1000}s` : error.message;
    }
    if (attempt >= RETRY_DELAYS_MS.length) return failure;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS.at(attempt)));
  }
}

function headersOf(alert) {
  const headers = alert.webhookConfiguration?.headers;
  if (!headers) return {};
  return headers instanceof Map ? Object.fromEntries(headers) : { ...headers };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "the webhook";
  }
}

// The Alerts section webhooks that subscribe to this alert type for this agent.
async function findAlertWebhooks(event, alertType) {
  const alerts = await AlertModel.find({ org_id: event.org_id, alertType }).lean();
  return alerts.filter((alert) => {
    const bridges = alert.bridges || [];
    return alert.webhookConfiguration?.url && (bridges.includes("all") || (event.agent_id && bridges.includes(event.agent_id)));
  });
}

async function sendToAlertWebhooks(event, reportFailure) {
  const { legacy_alert_type: alertType, webhook_body: body } = event.data || {};
  if (!alertType || !body || !event.org_id) return;
  const webhooks = await findAlertWebhooks(event, alertType);
  await Promise.all(
    webhooks.map(async (alert) => {
      const url = alert.webhookConfiguration.url;
      const failure = await postJson(url, body, headersOf(alert));
      if (!failure) return;
      logger.error(`[NotificationDispatch] ${alertType} alert to ${url} failed: ${failure}`);
      await reportFailure({ alert, alertType, url, failure });
    })
  );
}

async function sendTeamCopies(event) {
  const data = event.data || {};
  const sends = [];
  if (data.webhook_body && TEAM_COPY_ALERT_TYPES.has(data.legacy_alert_type) && event.source === "python") {
    sends.push(postJson(TEAM_ALERT_URL, data.webhook_body));
  }
  if (data.team_body) {
    // The producer picks the team flow ("alerts" for agent errors, "ops" for system issues) and
    // sends its own exact body; the hub owns the URLs.
    sends.push(postJson(data.team_route === "ops" ? TEAM_OPS_URL : TEAM_ALERT_URL, data.team_body));
  }
  const failures = (await Promise.all(sends)).filter(Boolean);
  failures.forEach((failure) => logger.error(`[NotificationDispatch] team alert for ${event.event_type} failed: ${failure}`));
}

async function sendUsageEmail(event) {
  const mailBody = event.data?.mail_body;
  if (!mailBody || !event.event_type.startsWith("usage.")) return;
  const failure = await postJson(USAGE_MAIL_URL, mailBody);
  if (failure) logger.error(`[NotificationDispatch] usage email for ${event.org_id} failed: ${failure}`);
}

// Sends one event everywhere it belongs besides the inbox. reportFailure is how a failed
// customer webhook gets back into the hub (as an in-app alert.webhook_failed).
async function dispatchEvent(event, reportFailure) {
  if (!NOTIFICATION_EVENTS[event.event_type]) return;
  await Promise.all([sendToAlertWebhooks(event, reportFailure), sendTeamCopies(event), sendUsageEmail(event)]);
}

export { dispatchEvent, hostOf, TEAM_ALERT_URL, TEAM_OPS_URL, USAGE_MAIL_URL };
