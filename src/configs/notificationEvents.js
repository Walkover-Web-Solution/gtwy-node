// Single catalogue of notification events. Mirrored in the Python backend at
// src/configs/notification_events.py — keep the two in sync.
//
// Every alert goes through the notification queue; the hub stores the in-app copy and sends it
// on to the webhooks configured in the Alerts section, GTWY team alerting and email.
//
// in_app: false = delivered to webhooks only, never shown in the inbox (response forwarding)
//
// audience: "org" = customer-facing, shown in the org's inbox
//           "internal" = GTWY team only, never shown to customers
//           "global" = broadcast to every org

const NOTIFICATION_SEVERITIES = ["info", "warning", "critical"];
const NOTIFICATION_AUDIENCES = ["org", "internal", "global"];

const NOTIFICATION_EVENTS = {
  "agent.error": {
    label: "Agent error",
    description: "An agent run failed",
    audience: "org",
    severity: "critical"
  },
  "agent.system_error": {
    label: "System error",
    description: "An internal error interrupted an agent run",
    audience: "org",
    severity: "critical"
  },
  "agent.variables_missing": {
    label: "Variables missing",
    description: "An agent ran without required variables",
    audience: "org",
    severity: "warning"
  },
  "agent.retry_started": {
    label: "Retry started",
    description: "An agent run is being retried after a failure",
    audience: "org",
    severity: "warning"
  },
  "agent.response_broadcast": {
    label: "Response broadcast",
    description: "An agent response forwarded to webhooks from the Alerts section",
    audience: "org",
    severity: "info",
    in_app: false
  },
  "agent.thumbs_down": {
    label: "Thumbs down",
    description: "A user rated an agent response thumbs down",
    audience: "org",
    severity: "info"
  },
  "agent.metrics_limit_reached": {
    label: "Metrics limit reached",
    description: "An agent crossed the metrics limit set in the Alerts section",
    audience: "org",
    severity: "warning"
  },
  "knowledge_base.alert": {
    label: "Knowledge base issue",
    description: "Knowledge base retrieval failed or returned no results",
    audience: "org",
    severity: "warning"
  },
  "alert.webhook_failed": {
    label: "Alert webhook failed",
    description: "An alert could not be delivered to a webhook from the Alerts section",
    audience: "org",
    severity: "warning"
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

export { NOTIFICATION_EVENTS, NOTIFICATION_EVENT_TYPES, NOTIFICATION_SEVERITIES, NOTIFICATION_AUDIENCES };
