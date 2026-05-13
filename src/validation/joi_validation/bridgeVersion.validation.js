import Joi from "joi";

const updateVersionSchema = Joi.object({
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
  service: Joi.string().valid("openai", "anthropic", "groq", "open_router", "mistral", "gemini", "grok", "deepgram").optional(),
  apikey_object_id: Joi.object()
    .pattern(Joi.string(), Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
    .optional(),
  user_reference: Joi.string().optional(),
  gpt_memory: Joi.boolean().optional(),
  gpt_memory_context: Joi.number().optional(),
  doc_ids: Joi.array().items(Joi.string()).optional(),
  IsstarterQuestionEnable: Joi.boolean().optional(),
  auto_model_select: Joi.boolean().optional(),
  cache_on: Joi.boolean().optional(),
  pre_tools: Joi.array().optional(),
  web_search_filters: Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.object()).optional(),
  gtwy_web_search_filters: Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.object()).optional(),
  connected_agent_flow: Joi.object().optional(),
  settings: Joi.object({
    publicUsers: Joi.array().items(Joi.string()).optional(),
    editAccess: Joi.array().items(Joi.string()).optional(),
    responseStyle: Joi.object().optional(),
    tone: Joi.object().optional(),
    responseStylePrompt: Joi.string().optional(),
    tonePrompt: Joi.string().optional(),
    maximum_iterations: Joi.number().min(3).optional(),
    response_format: Joi.object().optional(),
    fall_back: Joi.object({
      is_enable: Joi.boolean().optional(),
      service: Joi.string().optional(),
      model: Joi.string().optional()
    }).optional(),
    guardrails: Joi.object().optional()
  }).optional(),
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
  function_ids: Joi.array()
    .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
    .optional(),
  functionData: Joi.object({
    function_id: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .optional(),
    function_operation: Joi.string().valid("0", "1").optional(),
    script_id: Joi.string().optional()
  }).optional(),
  version_description: Joi.string().allow("").optional()
}).unknown(true);

const createVersion = {
  body: Joi.object()
    .keys({
      version_id: Joi.string().required(),
      version_description: Joi.string().optional().allow("")
    })
    .unknown(true)
};

const getVersion = {
  params: Joi.object()
    .keys({
      version_id: Joi.string().required()
    })
    .unknown(true)
};

const publishVersion = {
  params: Joi.object()
    .keys({
      version_id: Joi.string().required()
    })
    .unknown(true)
};

const removeVersion = {
  params: Joi.object()
    .keys({
      version_id: Joi.string().required()
    })
    .unknown(true)
};

const bulkPublishVersion = {
  body: Joi.object()
    .keys({
      version_ids: Joi.array().items(Joi.string().required()).min(1).required()
    })
    .unknown(true)
};

const discardVersion = {
  params: Joi.object()
    .keys({
      version_id: Joi.string().required()
    })
    .unknown(true)
};

const suggestModel = {
  params: Joi.object()
    .keys({
      version_id: Joi.string().required()
    })
    .unknown(true)
};

const getConnectedAgents = {
  params: Joi.object()
    .keys({
      version_id: Joi.string().required()
    })
    .unknown(true),
  query: Joi.object()
    .keys({
      type: Joi.string().optional()
    })
    .unknown(true)
};

const updateVersion = {
  params: Joi.object()
    .keys({
      version_id: Joi.string().required()
    })
    .unknown(true),
  body: updateVersionSchema
};

export default {
  createVersion,
  getVersion,
  updateVersion,
  publishVersion,
  removeVersion,
  bulkPublishVersion,
  discardVersion,
  suggestModel,
  getConnectedAgents
};
