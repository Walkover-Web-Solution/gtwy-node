import mongoose from "mongoose";
import { baseAgentFields, guardrailsSchema } from "./schemas/shared.js";
const Schema = mongoose.Schema;

const pageConfigSchema = new Schema(
  {
    url_slugname: { type: String, unique: true, sparse: true },
    description: { type: String, default: "" }
  },
  { _id: false }
);

const agentInfoSchema = new Schema(
  {
    prompt_total_tokens: { type: Number, default: 0 },
    availability: { type: String, enum: ["public", "private"], default: "public" },
    connected_agent_details: { type: Object, default: () => ({ variable_state: {} }) }
  },
  { _id: false }
);

const settingsSchema = new Schema(
  {
    publicUsers: { type: [String], default: () => [] },
    editAccess: { type: [Schema.Types.Mixed], default: () => [] },
    responseStyle: { type: String, default: "default" },
    tone: { type: String, default: "" },
    tonePrompt: { type: String, default: "" },
    response_format: {
      type: new Schema(
        {
          type: { type: String, default: "text" },
          cred: { type: Object, default: () => ({}) }
        },
        { _id: false }
      ),
      default: () => ({ type: "default", cred: {} })
    },
    responseStylePrompt: { type: String, default: "" },

    guardrails: { type: guardrailsSchema, default: () => ({ is_enabled: false, guardrails_configuration: {}, guardrails_custom_prompt: "" }) }
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
    versions: { type: [String], default: () => [] },
    page_config: { type: pageConfigSchema, default: () => ({}) },
    agent_info: { type: agentInfoSchema, default: () => ({}) },
    settings: { type: settingsSchema, default: () => ({}) },
    ai_updates: {
      prompt_enhancer_percentage: { type: Number, default: 0 },
      criteria_check: { type: Object, default: () => ({}) }
    },
    agent_limit: {
      bridge_limit: { type: Number, default: 0 },
      bridge_usage: { type: Number, default: 0 },
      bridge_limit_start_date: { type: Date, default: null },
      bridge_limit_reset_period: { type: String, enum: ["monthly", "weekly", "daily"], default: "monthly" }
    }
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
