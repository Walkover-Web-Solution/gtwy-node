import mongoose from "mongoose";
import { NOTIFICATION_CHANNEL_KINDS } from "../configs/notificationEvents.js";

// Where notifications are sent. Secrets (webhook headers, Slack URLs) are stored encrypted
// in `secret` and never returned by the API.
const notificationChannelSchema = new mongoose.Schema(
  {
    org_id: {
      type: String,
      required: true
    },
    kind: {
      type: String,
      enum: NOTIFICATION_CHANNEL_KINDS,
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    config: {
      // webhook: { url } · email: { recipients: [] } · slack: {}
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    secret: {
      // encrypted JSON — webhook: { headers } · slack: { webhook_url }
      type: String,
      default: null
    },
    enabled: {
      type: Boolean,
      default: true
    },
    consecutive_failures: {
      type: Number,
      default: 0
    },
    last_error: {
      type: String,
      default: null
    },
    last_success_at: {
      type: Date,
      default: null
    },
    disabled_reason: {
      type: String,
      default: null
    },
    legacy_alert_id: {
      type: String,
      default: null
    }
  },
  { timestamps: true }
);

notificationChannelSchema.index({ org_id: 1, kind: 1 });

const NotificationChannelModel = mongoose.model("NotificationChannel", notificationChannelSchema, "notification_channels");

export default NotificationChannelModel;
