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

const pageConfigSchema = new Schema(
  {
    url_slugname: {
      type: String,
      unique: true,
      sparse: true // this makes sure that if the url_slugname is not present in the document
      // mongo will still create an index on the field, and will not throw an error if the field is not present in the document.
      // This is useful when we are using the same schema for multiple collections, and not all collections have this field.
    },
    availability: {
      type: String,
      enum: ["public", "private"],
      default: "private"
    },
    allowedUsers: {
      type: [String],
      default: []
    }
  },
  { _id: false }
);

const configuration = new mongoose.Schema({
  org_id: {
    type: String,
    required: true
  },
  user_id: {
    type: String,
    required: true
  },
  service: {
    type: String,
    default: ""
  },
  bridgeType: {
    type: String,
    enum: ["api", "chatbot"],
    required: true,
    default: "chatbot"
  },
  name: {
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
  pre_tools: {
    type: Array,
    default: []
  },
  is_drafted: {
    type: Boolean,
    default: false
  },
  parent_id: {
    type: String,
    default: null
  },
  published_version_id: {
    type: String,
    default: null
  },
  variables_path: {
    type: Object,
    default: {}
  },
  variables_state: {
    type: Object,
    default: {}
  },
  starterQuestion: {
    type: Array,
    default: []
  },
  tool_call_count: {
    type: Number,
    default: 0
  },
  version_description: {
    type: String,
    default: ""
  },
  connected_agents: {
    type: Object,
    default: {}
  },
  doc_ids: {
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
  built_in_tools: {
    type: Array,
    default: []
  },
  fall_back: {
    type: Object,
    default: {
      is_enable: false,
      service: "",
      model: ""
    }
  },
  bridge_summary: {
    type: String,
    default: ""
  },
  connected_agent_details: {
    type: Object,
    default: {}
  },
  user_reference: {
    type: String,
    default: ""
  },
  bridge_status: {
    type: Number,
    default: 1
  },
  function_ids: {
    type: Array,
    default: []
  },
  agent_variables: {
    type: Object,
    default: {}
  },
  total_tokens: {
    type: Number,
    default: 0
  },
  prompt_total_tokens: {
    type: Number,
    default: 0
  },
  prompt_enhancer_percentage: {
    type: Number,
    default: 0
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
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
  slugName: {
    type: String,
    required: true
  },
  status: {
    type: Number,
    default: 1,
    required: true
  },
  responseIds: {
    type: Array,
    default: []
  },
  responseRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ResponseType"
  },
  versions: {
    type: [String],
    default: []
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
  IsstarterQuestionEnable: {
    type: Boolean
  },
  page_config: {
    type: pageConfigSchema,
    default: null
  },
  apikey_object_id: {
    type: Object
  },
  meta: {
    type: Object,
    default: {}
  },
  deletedAt: {
    type: Date,
    default: null
  },
  bridge_limit: {
    type: Number,
    default: 0
  },
  bridge_usage: {
    type: Number,
    default: 0
  },
  bridge_limit_reset_period: {
    type: String,
    enum: ["monthly", "weekly", "daily"],
    default: "monthly"
  },
  bridge_limit_start_date: {
    type: Date,
    default: null
  },
  last_used: {
    type: Date,
    default: null
  },
  users: {
    type: [mongoose.Schema.Types.Mixed],
    default: undefined
  },
  chatbot_auto_answers: {
    type: Boolean,
    default: false
  }
});

configuration.index({ org_id: 1, slugName: 1 }, { unique: true });
configuration.index({ deletedAt: 1 }, { expireAfterSeconds: 2592000 }); // TTL index for 30 days (1 month)
const configurationModel = mongoose.model("configuration", configuration);
export default configurationModel;
