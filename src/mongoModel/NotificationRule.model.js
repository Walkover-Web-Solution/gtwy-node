import mongoose from "mongoose";
import { NOTIFICATION_SEVERITIES } from "../configs/notificationEvents.js";

// Which events reach which channels. Replaces the Alert model.
const notificationRuleSchema = new mongoose.Schema(
  {
    org_id: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    event_types: {
      // catalogue event types, or ["*"] for every event
      type: [String],
      required: true
    },
    min_severity: {
      type: String,
      enum: NOTIFICATION_SEVERITIES,
      default: "info"
    },
    agents: {
      type: [String],
      default: () => ["all"]
    },
    channel_ids: {
      type: [String],
      default: () => []
    },
    throttle_seconds: {
      // null = the channel kind's default
      type: Number,
      default: null
    },
    limit: {
      // agent.metrics_limit_reached only: fire when the metric reaches this value
      type: Number,
      default: null
    },
    limit_metric: {
      type: String,
      enum: ["cost", "tokens", "requests", null],
      default: null
    },
    enabled: {
      type: Boolean,
      default: true
    },
    legacy_alert_id: {
      type: String,
      default: null
    }
  },
  { timestamps: true }
);

notificationRuleSchema.index({ org_id: 1, enabled: 1 });
notificationRuleSchema.index({ legacy_alert_id: 1 }, { unique: true, partialFilterExpression: { legacy_alert_id: { $type: "string" } } });

const NotificationRuleModel = mongoose.model("NotificationRule", notificationRuleSchema, "notification_rules");

export default NotificationRuleModel;
