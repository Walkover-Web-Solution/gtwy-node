import Joi from "joi";
import joiObjectId from "joi-objectid";

Joi.objectId = joiObjectId(Joi);

const createBridgeSchema = Joi.object({
  purpose: Joi.string().optional(),
  templateId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .optional(),
  bridgeType: Joi.string().valid("api", "chatbot").optional().default("api"),
  bridge_limit: Joi.number().min(0).optional(),
  bridge_usage: Joi.number().min(0).optional(),
  bridge_limit_reset_period: Joi.string().valid("monthly", "weekly", "daily").optional(),
  bridge_limit_start_date: Joi.date().optional()
}).unknown(true); // Allow additional fields that might be added dynamically

const updateBridgeSchema = Joi.object({
  configuration: Joi.object({
    model: Joi.string().optional(),
    type: Joi.string().valid("chat", "embedding", "completion", "fine-tune", "reasoning", "image").optional(),
    prompt: Joi.alternatives()
      .try(
        Joi.string().allow(""),
        Joi.array(),
        Joi.object({
          role: Joi.string().allow("").optional(),
          goal: Joi.string().allow("").optional(),
          instruction: Joi.string().allow("").optional(),
          // Embed-specific fields
          customPrompt: Joi.string().allow("").optional(),
          embedFields: Joi.array()
            .items(
              Joi.object({
                name: Joi.string().required(),
                value: Joi.string().allow("").optional(),
                type: Joi.string().valid("input", "textarea").optional(),
                hidden: Joi.boolean().optional()
              })
            )
            .optional(),
          useDefaultPrompt: Joi.boolean().optional()
        })
      )
      .optional(),
    system_prompt_version_id: Joi.string().optional(),
    fine_tune_model: Joi.object().optional(),
    response_format: Joi.object().optional(),
    is_rich_text: Joi.boolean().optional(),
    temperature: Joi.number().optional(),
    max_tokens: Joi.number().optional(),
    top_p: Joi.number().optional(),
    frequency_penalty: Joi.number().optional(),
    presence_penalty: Joi.number().optional(),
    stop: Joi.alternatives().try(Joi.string(), Joi.array()).optional(),
    stream: Joi.boolean().optional(),
    tools: Joi.array().optional(),
    tool_choice: Joi.string().optional(),
    n: Joi.number().optional(),
    logprobs: Joi.number().optional(),
    input: Joi.string().allow("").optional(),
    RTLayer: Joi.boolean().allow(null).optional(),
    webhook: Joi.string().allow("").optional(),
    encoded_prompt: Joi.string().optional()
  })
    .unknown(true)
    .optional(),
  service: Joi.string().valid("openai", "anthropic", "groq", "open_router", "mistral", "gemini", "ai_ml", "grok").optional(),
  apikey_object_id: Joi.object()
    .pattern(Joi.string(), Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
    .optional(),
  connected_agent_details: Joi.object().optional(),
  bridge_status: Joi.number().valid(0, 1).optional(),
  bridge_summary: Joi.string().allow("").optional(),
  expected_qna: Joi.array().optional(),
  slugName: Joi.string().optional(),
  tool_call_count: Joi.number().min(0).optional(),
  user_reference: Joi.string().optional(),
  gpt_memory: Joi.boolean().optional(),
  gpt_memory_context: Joi.number().optional(),
  doc_ids: Joi.array().items(Joi.string()).optional(),
  variables_state: Joi.object().optional(),
  IsstarterQuestionEnable: Joi.boolean().optional(),
  name: Joi.string().optional(),
  bridgeType: Joi.string().valid("api", "chatbot").optional(),
  meta: Joi.object().optional(),
  fall_back: Joi.object({
    is_enable: Joi.boolean().optional(),
    service: Joi.string().optional(),
    model: Joi.string().optional()
  }).optional(),
  guardrails: Joi.object().optional(),
  web_search_filters: Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.object()).optional(),
  gtwy_web_search_filters: Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.object()).optional(),
  bridge_limit: Joi.number().min(0).optional(),
  bridge_usage: Joi.number().min(0).optional(),
  bridge_limit_reset_period: Joi.string().valid("monthly", "weekly", "daily").optional(),
  bridge_limit_start_date: Joi.date().optional(),
  page_config: Joi.object().optional(),
  variables_path: Joi.object().optional(),
  built_in_tools_data: Joi.object({
    built_in_tools: Joi.array().items(Joi.string()).optional(),
    built_in_tools_operation: Joi.string().valid("0", "1").optional()
  }).optional(),
  agents: Joi.object({
    connected_agents: Joi.object()
      .pattern(
        Joi.string(),
        Joi.object({
          bridge_id: Joi.string()
            .pattern(/^[0-9a-fA-F]{24}$/)
            .optional()
        })
      )
      .optional(),
    agent_status: Joi.string().valid("0", "1").optional()
  }).optional(),
  functionData: Joi.object({
    function_id: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .optional(),
    function_operation: Joi.string().valid("0", "1").optional(),
    script_id: Joi.string().optional()
  }).optional(),
  version_description: Joi.string().allow("").optional()
}).unknown(true); // Allow additional fields

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

const getAgentsByModel = {
  params: modelNameParamSchema
};

const cloneAgent = {
  body: cloneAgentSchema
};

const getAgent = {
  params: bridgeIdParamSchema
};

// Export both the schemas and validation objects
export { createBridgeSchema, updateBridgeSchema, bridgeIdParamSchema, modelNameParamSchema, cloneAgentSchema };

export default {
  createAgent,
  getAgentsByModel,
  cloneAgent,
  getAgent
};
