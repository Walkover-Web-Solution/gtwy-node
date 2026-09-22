import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
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
    type: {
      type: String,
      required: true
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
    read_by: {
      type: [String],
      default: () => []
    }
  },
  { timestamps: true }
);

notificationSchema.index({ org_id: 1, createdAt: -1 });
notificationSchema.index({ org_id: 1, agent_id: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 }); // Deletes after 30 Days

const NotificationModel = mongoose.model("Notification", notificationSchema);

export default NotificationModel;
