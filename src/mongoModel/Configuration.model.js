import mongoose from "mongoose";
import { baseAgentFields } from "./schemas/shared.js";
const Schema = mongoose.Schema;

const pageConfigSchema = new Schema(
  {
    url_slugname: { type: String, unique: true, sparse: true },
    availability: { type: String, enum: ["public", "private"], default: "public" },
    description: { type: String, default: "" },
    allowedUsers: { type: [String], default: () => [] }
  },
  { _id: false }
);

const configuration = new mongoose.Schema(
  {
    ...baseAgentFields,
    name: { type: String, required: true },
    slugName: { type: String, required: true },
    last_used: { type: Date, default: null },
    meta: { type: Object, default: () => ({}) },
    bridgeType: { type: String, enum: ["api", "chatbot", "trigger"], required: true, default: "chatbot" },
    bridge_status: { type: Number, default: 1 },
    bridge_limit: { type: Number, default: 0 },
    bridge_usage: { type: Number, default: 0 },
    bridge_limit_start_date: { type: Date, default: null },
    bridge_limit_reset_period: { type: String, enum: ["monthly", "weekly", "daily"], default: "monthly" },
    versions: { type: [String], default: () => [] },
    criteria_check: { type: Object, default: () => ({}) },
    prompt_enhancer_percentage: { type: Number, default: 0 },
    prompt_total_tokens: { type: Number, default: 0 },
    page_config: { type: pageConfigSchema, default: null },
    users: { type: [Schema.Types.Mixed], default: () => [] }
  },
  {
    timestamps: true
  }
);

configuration.index({ org_id: 1, slugName: 1 }, { unique: true });
configuration.index({ deletedAt: 1 }, { expireAfterSeconds: 2592000 }); // TTL index for 30 days (1 month)
configuration.index({ org_id: 1, deletedAt: 1 });
const configurationModel = mongoose.model("configuration", configuration);
export default configurationModel;
