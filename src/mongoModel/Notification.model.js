import mongoose from "mongoose";
import { NOTIFICATION_AUDIENCES, NOTIFICATION_EVENT_TYPES, NOTIFICATION_SEVERITIES } from "../configs/notificationEvents.js";

const notificationSchema = new mongoose.Schema(
  {
    // Producer-generated id; the hub's idempotency key, so a redelivered event is stored once.
    event_id: {
      type: String,
      required: true
    },
    event_type: {
      type: String,
      enum: NOTIFICATION_EVENT_TYPES,
      required: true
    },
    audience: {
      type: String,
      enum: NOTIFICATION_AUDIENCES,
      default: "org"
    },
    severity: {
      type: String,
      enum: NOTIFICATION_SEVERITIES,
      default: "info"
    },
    org_id: {
      // null = broadcast to every org (a global notification), matching how
      // `agent_id: null` means "every agent within the org".
      type: String,
      default: null
    },
    agent_id: {
      type: String,
      default: null
    },
    title: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    dedupe_key: {
      type: String,
      default: null
    },
    source: {
      type: String,
      default: null
    },
    occurred_at: {
      type: Date,
      default: Date.now
    },
    read_by: {
      type: [String],
      default: () => []
    }
  },
  { timestamps: true }
);

notificationSchema.index({ event_id: 1 }, { unique: true });
notificationSchema.index({ org_id: 1, createdAt: -1 });
notificationSchema.index({ org_id: 1, agent_id: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 }); // Deletes after 30 Days

const NotificationModel = mongoose.model("Notification", notificationSchema);

export default NotificationModel;
