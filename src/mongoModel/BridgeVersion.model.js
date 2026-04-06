import mongoose from "mongoose";
import { baseAgentFields, fallBackSchema, guardrailsSchema } from "./schemas/shared.js";
const Schema = mongoose.Schema;

const settingsSchema = new Schema(
  {
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
    fall_back: { type: fallBackSchema, default: () => ({}) },
    guardrails: { type: guardrailsSchema, default: () => ({ is_enabled: false, guardrails_configuration: {}, guardrails_custom_prompt: "" }) }
  },
  { _id: false }
);

const agentInfoSchema = new Schema(
  {
    prompt_total_tokens: { type: Number, default: 0 },
    connected_agent_details: { type: Object, default: () => ({}) },
    variable_state: { type: Object, default: () => ({}) }
  },
  { _id: false }
);

const version = new mongoose.Schema(
  {
    ...baseAgentFields,
    // BridgeVersion-specific fields
    settings: { type: settingsSchema, default: () => ({}) },
    version_description: { type: String, default: "" },
    parent_id: { type: String, required: true },
    agent_info: { type: agentInfoSchema, default: () => ({}) }
  },
  {
    timestamps: true
  }
);

version.index({ deletedAt: 1 }, { expireAfterSeconds: 2592000 }); // TTL index for 30 days (1 month)
version.index({ org_id: 1, deletedAt: 1 });
const versionModel = mongoose.model("configuration_versions", version);
export default versionModel;
