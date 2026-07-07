import Joi from "joi";
import joiObjectId from "joi-objectid";

Joi.objectId = joiObjectId(Joi);

const connectedToolItemSchema = Joi.object({
  type: Joi.string().valid("tools", "agent", "docs", "pre_tool", "built_in_tools").required(),
  id: Joi.string().when("type", { is: Joi.valid("built_in_tools", "pre_tool"), then: Joi.optional(), otherwise: Joi.required() }),
  built_in_tools: Joi.array().items(Joi.string()).when("type", { is: "built_in_tools", then: Joi.required(), otherwise: Joi.optional() }),
  gtwy_web_search_filters: Joi.array().items(Joi.string()).optional(),
  web_search_filters: Joi.array().items(Joi.string()).optional(),
  variable_path: Joi.object().optional(),
  pre_tool_type: Joi.string()
    .valid("custom_function", "query_refiner", "gtwy_web_search", "rag_knowledgebase")
    .when("type", { is: "pre_tool", then: Joi.required(), otherwise: Joi.optional() }),
  prompt: Joi.string().allow("").optional(),
  formats: Joi.array().items(Joi.string()).optional(),
  url: Joi.string().optional(),
  thread_id: Joi.boolean().optional(),
  version_id: Joi.string().optional(),
  collection_id: Joi.string().optional(),
  resource_id: Joi.string().optional()
}).unknown(true);

const createBridgeSchema = Joi.object({
  purpose: Joi.string().optional(),
  templateId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .optional(),
  bridgeType: Joi.string().valid("api", "chatbot").optional().default("api"),
  bridge_limit: Joi.number().min(0).optional(),
  bridge_usage: Joi.number().min(0).optional(),
  bridge_limit_reset_period: Joi.string().valid("monthly", "weekly", "daily").optional(),
  bridge_limit_start_date: Joi.date().optional(),
  folder_id: Joi.string().allow(null).optional()
}).unknown(true); // Allow additional fields that might be added dynamically

const updateBridgeSchema = Joi.object({
  name: Joi.string().optional(),
  slugName: Joi.string().optional(),
  meta: Joi.object().optional(),
  bridge_summary: Joi.string().allow("").optional(),
  bridge_status: Joi.number().valid(0, 1).optional(),
  bridge_usage: Joi.number().min(0).optional(),
  bridge_limit: Joi.number().min(0).optional(),
  bridge_limit_reset_period: Joi.string().valid("monthly", "weekly", "daily").optional(),
  bridgeType: Joi.string().valid("api", "chatbot", "trigger").optional(),
  page_config: Joi.object().optional(),
  folder_id: Joi.string().allow(null).optional(),
  connected_agent_details: Joi.object().optional(),
  settings: Joi.object({
    responseStyle: Joi.object().optional(),
    tone: Joi.object().optional(),
    maximum_iterations: Joi.number().min(3).optional(),
    stateless_conversation: Joi.boolean().optional(),
    response_format: Joi.object().optional(),
    editAccess: Joi.array().items(Joi.number()).optional(),
    fall_back: Joi.object({
      is_enable: Joi.boolean().optional(),
      service: Joi.string().optional(),
      model: Joi.string().optional()
    }).optional(),
    guardrails: Joi.object().optional(),
    reviewer_agent: Joi.objectId().optional(),
    publicAgentConfig: Joi.object().optional(),
    environment_config: Joi.object().optional()
  }).optional(),
  bridge_limit_start_date: Joi.date().optional(),
  connected_tools: Joi.array().items(connectedToolItemSchema).optional(),
  connected_tool: connectedToolItemSchema.optional(),
  operation: Joi.alternatives()
    .try(Joi.string().valid("add", "update", "remove"), Joi.number().valid(0, 1, 2))
    .optional(),
  functionData: Joi.object({
    function_id: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .optional(),
    function_operation: Joi.string().valid("0", "1").optional(),
    script_id: Joi.string().optional()
  }).optional(),
  version_description: Joi.string().allow("").optional(),
  agent_info: Joi.object({
    prompt_total_tokens: Joi.number().min(0).optional(),
    description: Joi.string().allow("").optional(),
    agent_variables: Joi.object({
      fields: Joi.object().optional(),
      required: Joi.array().optional()
    }).optional(),
    thread_id: Joi.boolean().optional(),
    variables_state: Joi.object().optional(),
    ai_matching_custom_prompt: Joi.string().allow("").optional()
  }).optional(),
  starterQuestion: Joi.array().items(Joi.string()).optional()
});

const bridgeIdParamSchema = Joi.object({
  agent_id: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      "string.pattern.base": "agent_id must be a valid MongoDB ObjectId",
      "any.required": "agent_id is required"
    }),
  version_id: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .optional()
}).unknown(true);

const modelNameParamSchema = Joi.object({
  modelName: Joi.string().required().messages({
    "any.required": "modelName is required"
  })
}).unknown(true);

const createAgentFromTemplateParamSchema = Joi.object({
  template_id: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      "string.pattern.base": "template_id must be a valid MongoDB ObjectId",
      "any.required": "template_id is required"
    })
});

const cloneAgentSchema = Joi.object({
  agent_id: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      "string.pattern.base": "agent_id must be a valid MongoDB ObjectId",
      "any.required": "agent_id is required"
    }),
  to_shift_org_id: Joi.alternatives().try(Joi.string(), Joi.number()).required().messages({
    "any.required": "to_shift_org_id is required"
  })
}).unknown(true);

// Validation objects for use with validate middleware
const createAgent = {
  body: createBridgeSchema
};

const createAgentFromTemplate = {
  params: createAgentFromTemplateParamSchema
};

const getAgentsByModel = {
  params: modelNameParamSchema
};

const cloneAgent = {
  body: cloneAgentSchema
};

const getAgent = {
  params: bridgeIdParamSchema
};

const updateBridge = {
  body: updateBridgeSchema
};

// Export both the schemas and validation objects
export { createBridgeSchema, updateBridgeSchema, bridgeIdParamSchema, modelNameParamSchema, cloneAgentSchema, createAgentFromTemplateParamSchema };

export default {
  createAgent,
  createAgentFromTemplate,
  getAgentsByModel,
  cloneAgent,
  getAgent,
  updateBridge
};
