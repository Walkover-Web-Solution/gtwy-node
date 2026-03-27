import mongoose from "mongoose";
const Schema = mongoose.Schema;

const actionTypeModel = new Schema(
  {
    description: {
      type: String
    },
    type: {
      type: String
    },
    variable: {
      type: String
    }
  },
  {
    _id: false
  }
);
const version = new mongoose.Schema({
  org_id: {
    type: String,
    required: true
  },
  user_id: {
    type: String,
    required: true
  },
  apikey_object_id: {
    type: Object
  },
  service: {
    type: String,
    default: ""
  },
  configuration: {
    type: Object,
    default: {}
  },
  apikey: {
    type: String,
    default: ""
  },
  gpt_memory: {
    type: Boolean,
    default: false
  },
  gpt_memory_context: {
    type: String,
    default: null
  },
  folder_id: {
    type: String,
    default: null
  },
  is_drafted: {
    type: Boolean,
    default: false
  },
  parent_id: {
    type: String,
    default: null
  },
  variables_state: {
    type: Object,
    default: {}
  },
  function_ids: {
    type: [mongoose.Schema.Types.ObjectId],
    default: []
  },
  variables_path: {
    type: Object,
    default: {}
  },
  tool_call_count: {
    type: Number,
    default: 3
  },
  agent_variables: {
    type: Object,
    default: {}
  },
  published_version_id: {
    type: String,
    default: null
  },
  starterQuestion: {
    type: Array,
    default: []
  },
  total_tokens: {
    type: Number,
    default: 0
  },
  version_description: {
    type: String,
    default: ""
  },
  doc_ids: {
    type: Array,
    default: []
  },
  pre_tools: {
    type: Array,
    default: []
  },
  guardrails: {
    type: Object,
    default: {
      is_enabled: false,
      guardrails_configuration: {},
      guardrails_custom_prompt: ""
    }
  },
  web_search_filters: {
    type: [String],
    default: []
  },
  gtwy_web_search_filters: {
    type: [String],
    default: []
  },
  user_reference: {
    type: String,
    default: ""
  },
  fall_back: {
    type: Object,
    default: {
      is_enable: false,
      service: "",
      model: ""
    }
  },
  built_in_tools: {
    type: Array,
    default: []
  },
  connected_agent_details: {
    type: Object,
    default: {}
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  api_call: {
    type: Object,
    default: {}
  },
  api_endpoints: {
    type: Object,
    default: []
  },
  is_api_call: {
    type: Boolean,
    default: false
  },
  responseIds: {
    type: Array,
    default: []
  },
  responseRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ResponseType"
  },
  defaultQuestions: {
    type: Array
  },
  actions: {
    type: Map,
    of: actionTypeModel
  },
  hello_id: {
    type: String
  },
  connected_agents: {
    type: Object,
    default: {}
  },
  deletedAt: {
    type: Date,
    default: null
  },
  IsstarterQuestionEnable: {
    type: Boolean,
    default: false
  },
  chatbot_auto_answers: {
    type: Boolean,
    default: false
  },
  auto_model_select: {
    type: Boolean,
    default: false
  },
  cache_on: {
    type: Boolean,
    default: false
  }
});

version.index({ deletedAt: 1 }, { expireAfterSeconds: 2592000 }); // TTL index for 30 days (1 month)
version.index({ org_id: 1, deletedAt: 1 });
const versionModel = mongoose.model("configuration_versions", version);
export default versionModel;
