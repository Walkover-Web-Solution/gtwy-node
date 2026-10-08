// Maps the old Alert model onto notification channels and rules. Dependency-free (no models)
// so the alerts migration can import it.
import { INTERNAL_ORG_ID, LEGACY_ALERT_TYPE_TO_EVENT } from "../../configs/notificationEvents.js";
import { encryptSecret } from "../../utils/notificationSecrets.utils.js";

// The "default alert" the Python backend appends for every org (src/send_alert.py).
// It becomes one internal rule; see buildDefaultAlertDocs.
const LEGACY_DEFAULT_ALERT = {
  legacy_alert_id: "legacy-default-alert",
  name: "Default alert (GTWY)",
  url: process.env.NOTIFICATION_DEFAULT_ALERT_WEBHOOK_URL || "https://flow.sokt.io/func/scriYP8m551q",
  alert_types: ["Error", "Variable", "retry_mechanism"]
};

function mapAlertTypes(alertTypes = []) {
  return [...new Set(alertTypes.map((type) => LEGACY_ALERT_TYPE_TO_EVENT[type]).filter(Boolean))];
}

function headersToPlainObject(headers) {
  if (!headers) return {};
  if (headers instanceof Map) return Object.fromEntries(headers);
  return { ...headers };
}

// Channel + rule documents (minus ids) for one Alert document.
function buildDocsFromAlert(alert) {
  const legacy_alert_id = String(alert._id);
  const headers = headersToPlainObject(alert.webhookConfiguration?.headers);
  const channel = {
    org_id: String(alert.org_id),
    kind: "webhook",
    name: alert.name,
    config: { url: alert.webhookConfiguration?.url },
    secret: Object.keys(headers).length ? encryptSecret({ headers }) : null,
    enabled: true,
    legacy_alert_id
  };
  const rule = {
    org_id: String(alert.org_id),
    name: alert.name,
    event_types: mapAlertTypes(alert.alertType),
    min_severity: "info",
    // Same as the legacy matcher: an empty bridges list matches no agent.
    agents: (alert.bridges || []).map(String),
    // Legacy webhooks were never throttled.
    throttle_seconds: 0,
    limit: alert.limit ?? null,
    limit_metric: null,
    enabled: true,
    legacy_alert_id
  };
  return { channel, rule };
}

function buildDefaultAlertDocs() {
  return buildDocsFromAlert({
    _id: LEGACY_DEFAULT_ALERT.legacy_alert_id,
    org_id: INTERNAL_ORG_ID,
    name: LEGACY_DEFAULT_ALERT.name,
    webhookConfiguration: { url: LEGACY_DEFAULT_ALERT.url, headers: {} },
    alertType: LEGACY_DEFAULT_ALERT.alert_types,
    bridges: ["all"]
  });
}

export { LEGACY_DEFAULT_ALERT, mapAlertTypes, buildDocsFromAlert, buildDefaultAlertDocs };
