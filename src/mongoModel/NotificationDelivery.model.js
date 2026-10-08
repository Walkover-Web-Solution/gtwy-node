import mongoose from "mongoose";

// One row per event × rule × channel. Also the idempotency guard for outbound sends:
// a redelivered event cannot create a second row for the same rule and channel.
const notificationDeliverySchema = new mongoose.Schema(
  {
    event_id: { type: String, required: true },
    event_type: { type: String, required: true },
    notification_id: { type: String, default: null },
    org_id: { type: String, default: null },
    agent_id: { type: String, default: null },
    rule_id: { type: String, required: true },
    channel_id: { type: String, required: true },
    channel_kind: { type: String, required: true },
    // Sent by a GTWY internal rule: hidden from the org's delivery log.
    internal: { type: Boolean, default: false },
    status: {
      // shadow = would have been sent (NOTIFICATION_HUB_MODE=shadow); sending = claimed by a worker
      type: String,
      enum: ["pending", "sending", "sent", "failed", "throttled", "shadow"],
      required: true
    },
    payload: {
      // the exact body to send, kept so retries resend the same thing
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    attempts: { type: Number, default: 0 },
    response_code: { type: Number, default: null },
    error: { type: String, default: null },
    next_retry_at: { type: Date, default: null },
    sent_at: { type: Date, default: null }
  },
  // minimize: false keeps empty objects in payload ("variables": {}), so a retried body is byte-identical.
  { timestamps: true, minimize: false }
);

notificationDeliverySchema.index({ event_id: 1, rule_id: 1, channel_id: 1 }, { unique: true });
notificationDeliverySchema.index({ status: 1, next_retry_at: 1 });
notificationDeliverySchema.index({ org_id: 1, createdAt: -1 });
notificationDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 }); // Deletes after 30 Days

const NotificationDeliveryModel = mongoose.model("NotificationDelivery", notificationDeliverySchema, "notification_deliveries");

export default NotificationDeliveryModel;
