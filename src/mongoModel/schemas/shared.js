import mongoose from "mongoose";
const Schema = mongoose.Schema;

const configurationSubSchema = new Schema(
  {
    type: { type: String, default: "chat" },
    model: { type: String, default: "" },
    fine_tune_model: { type: String, default: "" },
    prompt: { type: Schema.Types.Mixed, default: "" },
    creativity_level: { type: Number, default: 0.5 },
    max_tokens: { type: Schema.Types.Mixed, default: "default" },
    token_selection_limit: { type: Number, default: 0 },
    response_count: { type: Number, default: 1 },
    best_response_count: { type: Number, default: 1 },
    novelty_penalty: { type: Number, default: 0 },
    repetition_penalty: { type: Number, default: 0 },
    probability_cutoff: { type: Number, default: 0 },
    additional_stop_sequences: { type: Array, default: () => [] },
    echo_input: { type: Boolean, default: false },
    parallel_tool_calls: { type: Boolean, default: false },
    response_type: { type: String, default: "default" },
    responseStyle: { type: String, default: "default" },
    responseStylePrompt: { type: String, default: "" },
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
    is_rich_text: { type: Boolean, default: false },
    log_probability: { type: Boolean, default: false },
    size: { type: String, default: "" },
    image_size: { type: String, default: "" },
    number_of_images: { type: Number, default: 1 },
    aspect_ratio: { type: String, default: "" },
    dimensions: { type: String, default: "" },
    quality: { type: String, default: "standard" },
    style: { type: String, default: "" },
    frame_rate: { type: Number, default: 0 },
    duration_seconds: { type: Number, default: 0 },
    resolution: { type: String, default: "" },
    video_settings: { type: Object, default: () => ({}) },
    camera_fixed: { type: Boolean, default: false },
    person_generation: { type: Boolean, default: false },
    tool_choice: { type: String, default: "default" },
    auto_model_select: { type: Boolean, default: false },
    reasoning: { type: Schema.Types.Mixed, default: null },
    input_text: { type: String, default: "" },
    response_suffix: { type: String, default: "" }
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

// Add this after the existing schemas, before the export

const actionTypeSchema = new Schema(
  {
    description: { type: String },
    type: { type: String },
    variable: { type: String }
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
  tool_call_count: { type: Number, default: 0 },
  IsstarterQuestionEnable: { type: Boolean, default: false },
  starterQuestion: { type: Array, default: () => [] },
  user_reference: { type: String, default: null },
  variables_state: { type: Object, default: () => ({}) },
  variables_path: { type: Object, default: () => ({}) },
  agent_variables: { type: Object, default: () => ({}) },
  function_ids: { type: Array, default: () => [] },
  doc_ids: { type: Array, default: () => [] },
  pre_tools: { type: Array, default: () => [] },
  built_in_tools: { type: Array, default: () => [] },
  web_search_filters: { type: Array, default: () => [] },
  gtwy_web_search_filters: { type: Array, default: () => [] },
  connected_agents: { type: Object, default: () => ({}) },
  connected_agent_details: { type: Object, default: () => ({}) },
  actions: { type: Map, of: actionTypeSchema, default: () => ({}) },
  chatbot_auto_answers: { type: Boolean, default: false },
  configuration: { type: configurationSubSchema, default: () => ({}) },
  fall_back: { type: fallBackSchema, default: () => ({}) },
  guardrails: { type: guardrailsSchema, default: () => ({ is_enabled: false, guardrails_configuration: {}, guardrails_custom_prompt: "" }) }
};

export { configurationSubSchema, fallBackSchema, guardrailsSchema, baseAgentFields, actionTypeSchema };
