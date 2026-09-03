import Joi from "joi";

const createService = {
  body: Joi.object().keys({
    service_name: Joi.string().required(),
    base_url: Joi.string().allow(null).default(null),
    wire_format: Joi.string().required(), // openai_chat | openai_responses | anthropic | gemini | deepgram
    client: Joi.string().required(), // openai_sdk | groq_sdk | grok_http | mistral_sdk | openai_completion_sdk | anthropic_sdk | gemini_sdk | deepgram_sdk | minimax_sdk
    supports_streaming: Joi.boolean().default(false),
    supports_tool_calls: Joi.boolean().default(false),
    supports_stream_usage: Joi.boolean().default(false),
    supports_reasoning: Joi.boolean().default(false),
    reasoning_param_style: Joi.string().allow(null).default(null),
    extra_body: Joi.object().unknown(true).default({}),
    reasoning_extra_body: Joi.object().unknown(true).default({}),
    default_model: Joi.string().allow(null).default(null),
    default_fallback_model: Joi.string().allow(null).default(null),
    prompt_role: Joi.string().default("system"),
    apikey_status_codes: Joi.object().unknown(true).default({}),
    validation_config: Joi.object().unknown(true).default({}),
    service_keys: Joi.object().unknown(true).default({}),
    status: Joi.number().valid(0, 1).default(1)
  })
};

export default { createService };
