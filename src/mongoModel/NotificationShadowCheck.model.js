import mongoose from "mongoose";

// Shadow mode only: for each legacy-typed event, the webhook URLs the old alert path would
// send to versus the URLs the hub's rules matched. The cutover gate is 7 days of matches.
const notificationShadowCheckSchema = new mongoose.Schema(
  {
    event_id: { type: String, required: true },
    event_type: { type: String, required: true },
    org_id: { type: String, default: null },
    agent_id: { type: String, default: null },
    legacy_urls: { type: [String], default: () => [] },
    hub_urls: { type: [String], default: () => [] },
    match: { type: Boolean, required: true }
  },
  { timestamps: true }
);

notificationShadowCheckSchema.index({ event_id: 1 }, { unique: true });
notificationShadowCheckSchema.index({ match: 1, createdAt: -1 });
notificationShadowCheckSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 }); // Deletes after 30 Days

const NotificationShadowCheckModel = mongoose.model("NotificationShadowCheck", notificationShadowCheckSchema, "notification_shadow_checks");

export default NotificationShadowCheckModel;
