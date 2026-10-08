// Single catalogue of notification events. Mirrored in the Python backend at
// src/configs/notification_events.py — keep the two in sync.
//
// audience: "org" = customer-facing, shown in the org's inbox
//           "internal" = GTWY team only, never shown to customers
//           "global" = broadcast to every org
// legacy_alert_type: the old Alert.alertType value this event replaces (used by webhook migration)
// in_app: false = routed to channels only, never stored in the inbox (high-volume data forwarding)

const NOTIFICATION_SEVERITIES = ["info", "warning", "critical"];
const NOTIFICATION_AUDIENCES = ["org", "internal", "global"];

const NOTIFICATION_EVENTS = {
  "agent.error": {
    label: "Agent error",
    description: "An agent run failed",
    audience: "org",
    severity: "critical",
    legacy_alert_type: "Error"
  },
  "agent.variables_missing": {
    label: "Variables missing",
    description: "An agent ran without required variables",
    audience: "org",
    severity: "warning",
    legacy_alert_type: "Variable"
  },
  "agent.retry_started": {
    label: "Retry started",
    description: "An agent run is being retried after a failure",
    audience: "org",
    severity: "warning",
    legacy_alert_type: "retry_mechanism"
  },
  "agent.response_broadcast": {
    label: "Response broadcast",
    description: "An agent response forwarded to webhooks",
    audience: "org",
    severity: "info",
    legacy_alert_type: "broadcast_response",
    in_app: false
  },
  "agent.thumbs_down": {
    label: "Thumbs down",
    description: "A user rated an agent response thumbs down",
    audience: "org",
    severity: "info",
    legacy_alert_type: "thumbsdown"
  },
  "agent.metrics_limit_reached": {
    label: "Metrics limit reached",
    description: "An agent's daily cost, tokens or requests crossed a rule's limit",
    audience: "org",
    severity: "warning",
    legacy_alert_type: "metrix_limit_reached"
  },
  "knowledge_base.alert": {
    label: "Knowledge base issue",
    description: "Knowledge base retrieval failed or returned no results",
    audience: "org",
    severity: "warning",
    legacy_alert_type: "knowledge_base"
  },
  "usage.threshold_reached": {
    label: "Usage threshold reached",
    description: "Usage crossed the alert threshold of a limit",
    audience: "org",
    severity: "warning"
  },
  "usage.limit_reached": {
    label: "Usage limit reached",
    description: "Usage hit 100% of a limit",
    audience: "org",
    severity: "critical"
  },
  "usage.daily_spike": {
    label: "Daily usage spike",
    description: "Today's spend is well above the recent daily average",
    audience: "org",
    severity: "warning"
  },
  "billing.credits_exhausted": {
    label: "Credits exhausted",
    description: "The organization has run out of credits",
    audience: "org",
    severity: "critical"
  },
  "apikey.status_changed": {
    label: "API key status changed",
    description: "An API key was marked invalid or restored",
    audience: "org",
    severity: "warning"
  },
  "channel.disabled": {
    label: "Notification channel disabled",
    description: "A channel was disabled after repeated delivery failures",
    audience: "org",
    severity: "warning"
  },
  "system.announcement": {
    label: "Announcement",
    description: "A message from the GTWY team to every organization",
    audience: "global",
    severity: "info"
  },
  "ops.internal_error": {
    label: "Internal error",
    description: "An internal error for the GTWY team",
    audience: "internal",
    severity: "critical"
  },
  "ops.queue_failure": {
    label: "Queue failure",
    description: "A RabbitMQ publish or consume failure",
    audience: "internal",
    severity: "critical"
  }
};

const NOTIFICATION_EVENT_TYPES = Object.keys(NOTIFICATION_EVENTS);

const LEGACY_ALERT_TYPE_TO_EVENT = Object.fromEntries(
  Object.entries(NOTIFICATION_EVENTS)
    .filter(([, event]) => event.legacy_alert_type)
    .map(([eventType, event]) => [event.legacy_alert_type, eventType])
);

const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 };

const NOTIFICATION_CHANNEL_KINDS = ["webhook", "email", "slack"];

// Org id that marks GTWY-owned channels and rules. Internal rules match events from every org.
const INTERNAL_ORG_ID = "__internal__";

// off: in-app only (Phase 1) · shadow: match rules and log would-be deliveries, send nothing
// · on: deliver to channels. Read per call so a deploy can flip it without code changes.
const getNotificationHubMode = () => {
  const mode = (process.env.NOTIFICATION_HUB_MODE || "off").toLowerCase();
  return ["off", "shadow", "on"].includes(mode) ? mode : "off";
};

export {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_CHANNEL_KINDS,
  LEGACY_ALERT_TYPE_TO_EVENT,
  SEVERITY_RANK,
  INTERNAL_ORG_ID,
  getNotificationHubMode
};
