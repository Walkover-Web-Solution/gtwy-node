import mongoose from "mongoose";
// import ModelConfigService from "../../services/modelConfig.service.js";
const Schema = mongoose.Schema;

// Reusable schema for a single advanced parameter (mode + value)
const advancedParamValueSchema = new Schema(
  {
    mode: {
      type: String,
      enum: ["default", "min", "max", "custom"],
      default: "default"
    },
    value: {
      type: Number,
      default: null
    }
  },
  { _id: false }
);

const configurationSubSchema = new Schema(
  {
    type: { type: String, default: "chat" },
    model: { type: String, default: "" },
    fine_tune_model: { type: String, default: "" },
    prompt: { type: Schema.Types.Mixed, default: "" },
    creativity_level: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) },
    max_tokens: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) },
    token_selection_limit: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) },
    response_count: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) },
    best_response_count: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) },
    novelty_penalty: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) },
    repetition_penalty: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) },
    probability_cutoff: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) },
    additional_stop_sequences: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) },
    echo_input: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) },
    parallel_tool_calls: { type: Boolean, default: false },
    response_type: { type: String, default: "default" },
    log_probability: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) },
    size: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) },
    n: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) },
    aspect_ratio: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) },
    dimensions: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) },
    quality: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) },
    style: { type: String, default: "" },
    tool_choice: { type: String, default: "default" },
    auto_model_select: { type: Boolean, default: false },
    reasoning: { type: Schema.Types.Mixed, default: null },
    input_text: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) },
    response_suffix: { type: advancedParamValueSchema, default: () => ({ mode: "default", value: null }) }
  },
  { _id: false }
);

const fallBackSchema = new Schema(
  {
    is_enable: { type: Boolean, default: false },
    model: { type: String, default: "" },
    service: { type: String, default: "" }
  },
  { _id: false }
);

const guardrailsSchema = new Schema(
  {
    is_enabled: { type: Boolean, default: false },
    guardrails_configuration: { type: Object, default: () => ({}) },
    guardrails_custom_prompt: { type: String, default: "" }
  },
  { _id: false }
);

const actionTypeSchema = new Schema(
  {
    description: { type: String },
    type: { type: String },
    variable: { type: String }
  },
  { _id: false }
);

const connectedToolsSchema = new Schema(
  {
    function_ids: { type: Array, default: () => [] },
    connected_agents: { type: Object, default: () => ({}) },
    built_in_tools: { type: Array, default: () => [] },
    docs_ids: { type: Array, default: () => [] },
    variable_path: { type: Object, default: () => ({}) },
    web_search_filters: { type: Array, default: () => [] }
  },
  { _id: false }
);

// Base schema fields shared between Configuration and BridgeVersion
const baseAgentFields = {
  org_id: { type: String, required: true },
  user_id: { type: String, default: null },
  folder_id: { type: String, default: null },
  service: { type: String, default: "" },
  apikey_object_id: { type: Object, default: () => ({}) },
  published_version_id: { type: String, default: null },
  gpt_memory: { type: Boolean, default: false },
  gpt_memory_context: { type: String, default: null },
  deletedAt: { type: Date, default: null },
  maximum_iterations: { type: Number, default: 0 },
  IsstarterQuestionEnable: { type: Boolean, default: false },
  starterQuestion: { type: Array, default: () => [] },
  agent_variables: { type: Object, default: () => ({}) },
  pre_tools: { type: Array, default: () => [] },
  gtwy_web_search_filters: { type: Array, default: () => [] },
  actions: { type: Map, of: actionTypeSchema, default: () => ({}) },
  chatbot_auto_answers: { type: Boolean, default: false },
  configuration: { type: configurationSubSchema, default: () => ({}) },
  connected_tools: { type: connectedToolsSchema, default: () => ({}) }
};

export {
  configurationSubSchema,
  fallBackSchema,
  guardrailsSchema,
  baseAgentFields,
  actionTypeSchema,
  connectedToolsSchema,
  advancedParamValueSchema
};
