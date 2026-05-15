import Joi from "joi";

const updateVersionSchema = Joi.object({
  configuration: Joi.object({
    model: Joi.string().optional(),
    type: Joi.string().valid("chat", "embedding", "fine-tune", "reasoning", "image").optional(),
    prompt: Joi.alternatives().try(Joi.string().allow(""), Joi.object()).optional(),
    fine_tune_model: Joi.alternatives().try(Joi.object(), Joi.string()).optional(),
    response_format: Joi.alternatives().try(Joi.object(), Joi.string()).optional(),
    is_rich_text: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
    temperature: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
    max_tokens: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
    top_p: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
    frequency_penalty: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
    presence_penalty: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
    stop: Joi.alternatives().try(Joi.string(), Joi.array()).optional(),
    stream: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
    tools: Joi.alternatives().try(Joi.array(), Joi.string()).optional(),
    tool_choice: Joi.string().optional(),
    n: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
    logprobs: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
    input: Joi.string().allow("").optional(),
    RTLayer: Joi.alternatives().try(Joi.boolean(), Joi.string()).allow(null).optional(),
    webhook: Joi.string().allow("").optional(),
    creativity_level: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
    token_selection_limit: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
    response_count: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
    best_response_count: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
    novelty_penalty: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
    repetition_penalty: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
    probability_cutoff: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
    echo_input: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
    parallel_tool_calls: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
    response_type: Joi.string().allow("").optional(),
    log_probability: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
    image_size: Joi.string().allow("").optional(),
    number_of_images: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
    aspect_ratio: Joi.string().allow("").optional(),
    dimensions: Joi.string().allow("").optional(),
    quality: Joi.string().allow("").optional(),
    style: Joi.string().allow("").optional(),
    additional_stop_sequences: Joi.alternatives().try(Joi.string(), Joi.array()).optional(),
    response_suffix: Joi.string().allow("").optional(),
    language: Joi.string().allow("").optional(),
    smart_format: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
    detect_language: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
    diarize: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
    filler_words: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
    punctuate: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
    numerals: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
    detect_entities: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
    model_option: Joi.string().allow("").optional()
  }).optional(),
  service: Joi.string().valid("openai", "anthropic", "groq", "open_router", "mistral", "gemini", "grok", "deepgram").optional(),
  apikey_object_id: Joi.object()
    .pattern(Joi.string(), Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
    .optional(),
  user_reference: Joi.string().optional(),
  gpt_memory: Joi.boolean().optional(),
  gpt_memory_context: Joi.number().optional(),
  doc_ids: Joi.array().items(Joi.object()).optional(),
  IsstarterQuestionEnable: Joi.boolean().optional(),
  auto_model_select: Joi.object().optional(),
  cache_on: Joi.boolean().optional(),
  pre_tools: Joi.array().optional(),
  web_search_filters: Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.object()).optional(),
  gtwy_web_search_filters: Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.object()).optional(),
  connected_agent_flow: Joi.object().optional(),
  settings: Joi.object({
    reviewer_agent: Joi.string().allow(null).optional(),
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
  variables_state: Joi.object().optional(),
  built_in_tools_data: Joi.object({
    built_in_tools: Joi.string().optional(),
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
});

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
