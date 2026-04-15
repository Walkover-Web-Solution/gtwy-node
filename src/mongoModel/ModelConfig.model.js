import mongoose from "mongoose";

const ConfigurationSchema = new mongoose.Schema({
  service: {
    type: String,
    required: true
  },
  model_name: {
    type: String,
    required: true
  },
  configuration: {
    model: {
      type: { field: { type: String }, level: { type: Number }, default: { type: String } },
      default: undefined,
      _id: false
    },
    creativity_level: {
      type: {
        field: { type: String },
        min: { type: Number },
        max: { type: Number },
        step: { type: Number },
        level: { type: Number },
        default: { type: Number }
      },
      default: undefined,
      _id: false
    },
    max_tokens: {
      type: {
        field: { type: String },
        min: { type: Number },
        max: { type: Number },
        step: { type: Number },
        level: { type: Number },
        default: { type: Number }
      },
      default: undefined,
      _id: false
    },
    probability_cutoff: {
      type: {
        field: { type: String },
        min: { type: Number },
        max: { type: Number },
        step: { type: Number },
        level: { type: Number },
        default: { type: Number }
      },
      default: undefined,
      _id: false
    },
    log_probability: {
      type: { field: { type: String }, level: { type: Number }, typeOf: { type: String }, default: { type: Boolean } },
      default: undefined,
      _id: false
    },
    repetition_penalty: {
      type: {
        field: { type: String },
        min: { type: Number },
        max: { type: Number },
        step: { type: Number },
        level: { type: Number },
        default: { type: Number }
      },
      default: undefined,
      _id: false
    },
    novelty_penalty: {
      type: {
        field: { type: String },
        min: { type: Number },
        max: { type: Number },
        step: { type: Number },
        level: { type: Number },
        default: { type: Number }
      },
      default: undefined,
      _id: false
    },
    response_count: {
      type: { field: { type: String }, typeOf: { type: String }, level: { type: Number }, default: { type: Number } },
      default: undefined,
      _id: false
    },
    stop: {
      type: { field: { type: String }, level: { type: Number }, default: { type: String } },
      default: undefined,
      _id: false
    },
    tools: {
      type: { field: { type: String }, level: { type: Number }, typeOf: { type: String }, default: { type: Array } },
      default: undefined,
      _id: false
    },
    tool_choice: {
      type: {
        field: { type: String },
        options: { type: Array },
        level: { type: Number },
        typeOf: { type: String },
        default: { type: String }
      },
      default: undefined,
      _id: false
    },
    response_type: {
      type: { field: { type: String }, options: { type: Array }, level: { type: Number }, default: { type: Object } },
      default: undefined,
      _id: false
    },
    parallel_tool_calls: {
      type: { field: { type: String }, level: { type: Number }, typeOf: { type: String }, default: { type: Boolean } },
      default: undefined,
      _id: false
    }
  },
  outputConfig: {
    usage: [
      {
        prompt_tokens: { type: String },
        completion_tokens: { type: String },
        total_tokens: { type: String },
        cached_tokens: { type: String },
        total_cost: {
          input_cost: { type: Number },
          output_cost: { type: Number },
          cached_cost: { type: Number }
        }
      }
    ],
    message: { type: String },
    tools: { type: String },
    assistant: { type: String }
  },
  validationConfig: {
    system_prompt: { type: Boolean },
    type: { type: String },
    vision: { type: Boolean },
    tools: { type: Boolean },
    specification: {
      input_cost: { type: Number },
      output_cost: { type: Number },
      description: { type: String },
      knowledge_cutoff: { type: String },
      usecase: [{ type: String }]
    }
  },
  status: { type: Number, default: 1 },
  disabled_at: { type: Date, default: null },
  display_name: { type: String, required: false },
  org_id: { type: String, required: false }
});

ConfigurationSchema.index({ model_name: 1, service: 1 }, { unique: true });
ConfigurationSchema.index({ disabled_at: 1 }, { expireAfterSeconds: 2592000, partialFilterExpression: { status: 0 } }); // Deletes after 30 Days if status is 0
const ModelsConfigModel = mongoose.model("modelConfiguration", ConfigurationSchema);
export default ModelsConfigModel;
