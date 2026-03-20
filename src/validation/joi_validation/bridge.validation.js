import Joi from "joi";
const updateBridgeSchema = Joi.object({
  bridge_id: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .required(),
  bridgeType: Joi.string().valid("chatbot", "api"),
  slugName: Joi.string().alphanum(),
  configuration: Joi.object({
    model: Joi.string()
      .when(Joi.ref("/service"), {
        is: "google",
        then: Joi.valid("gemini-pro", "gemini-1.5-pro", "gemini-1.0-pro-vision", "gemini-1.0-pro", "gemini-1.5-Flash", "embedding-001"),
        otherwise: Joi.string().valid(
          "gpt-3.5-turbo",
          "gpt-3.5-turbo-0613",
          "gpt-3.5-turbo-0125",
          "gpt-3.5-turbo-1106",
          "gpt-3.5-turbo-16k",
          "gpt-3.5-turbo-16k-0613",
          "gpt-4",
          "gpt-4-0613",
          "gpt-4-1106-preview",
          "gpt-4-turbo-preview",
          "gpt-4-0125-preview",
          "gpt-4-turbo-2024-04-09",
          "gpt-4-turbo",
          "gpt-4o",
          "gpt-4o-mini",
          "text-embedding-3-large",
          "text-embedding-3-small",
          "text-embedding-ada-002",
          "gpt-3.5-turbo-instruct"
        )
      })
      .required(),
    type: Joi.string().valid("chat", "embedding", "completion"),
    prompt: Joi.alternatives().try(Joi.string().allow(""), Joi.array()).optional(),
    input: Joi.string().allow("").optional(),
    RTLayer: Joi.boolean().allow(null).optional(),
    webhook: Joi.string().allow("").optional()
  }),
  service: Joi.string().valid("openai", "google").required(),
  apikey: Joi.string()
    .regex(/^[a-zA-Z0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]*$/)
    .optional()
    .allow(""),
  org_id: Joi.string().required().messages({
    "string.base": "The input must be a string"
  })
})
  .when(
    Joi.object({
      "configuration.model": Joi.string().valid(
        "gpt-3.5-turbo",
        "gpt-3.5-turbo-0613",
        "gpt-3.5-turbo-0125",
        "gpt-3.5-turbo-0301",
        "gpt-3.5-turbo-1106",
        "gpt-3.5-turbo-16k",
        "gpt-3.5-turbo-16k-0613",
        "gpt-4",
        "gpt-4-0613",
        "gpt-4-1106-preview",
        "gpt-4-turbo-preview",
        "gpt-4-0125-preview",
        "gpt-4-turbo-2024-04-09",
        "gpt-4-turbo",
        "gpt-4o",
        "gpt-4o-mini",
        "text-embedding-3-large",
        "text-embedding-3-small",
        "text-embedding-ada-002",
        "gpt-3.5-turbo-instruct",
        "gemini-pro",
        "gemini-1.5-pro",
        "gemini-1.0-pro-vision",
        "gemini-1.0-pro",
        "gemini-1.5-Flash"
      )
    }).unknown(),
    {
      then: Joi.object({
        configuration: Joi.object({
          // Define validation specific to each model here
          "gpt-3.5-turbo": Joi.object({
            temperature: Joi.string(),
            max_tokens: Joi.string(),
            top_p: Joi.string(),
            logprobs: Joi.string(),
            frequency_penalty: Joi.string(),
            presence_penalty: Joi.string(),
            n: Joi.string(),
            stop: Joi.string(),
            stream: Joi.string()
          }),
          "gpt-3.5-turbo-0613": Joi.object({
            temperature: Joi.string(),
            max_tokens: Joi.string(),
            top_p: Joi.string(),
            logprobs: Joi.string(),
            frequency_penalty: Joi.string(),
            presence_penalty: Joi.string(),
            n: Joi.string(),
            stop: Joi.string(),
            stream: Joi.string()
          }),
          "gpt-3.5-turbo-0125": Joi.object({
            temperature: Joi.string(),
            max_tokens: Joi.string(),
            top_p: Joi.string(),
            logprobs: Joi.string(),
            frequency_penalty: Joi.string(),
            presence_penalty: Joi.string(),
            n: Joi.string(),
            stop: Joi.string(),
            stream: Joi.string(),
            tools: Joi.string(),
            tool_choice: Joi.string(),
            response_format: Joi.string()
          }),
          "gpt-3.5-turbo-0301": Joi.object({
            temperature: Joi.string(),
            max_tokens: Joi.string(),
            top_p: Joi.string(),
            logprobs: Joi.string(),
            frequency_penalty: Joi.string(),
            presence_penalty: Joi.string(),
            n: Joi.string(),
            stop: Joi.string(),
            stream: Joi.string(),
            tools: Joi.string(),
            tool_choice: Joi.string(),
            response_format: Joi.string()
          }),
          "gpt-3.5-turbo-1106": Joi.object({
            temperature: Joi.string(),
            max_tokens: Joi.string(),
            top_p: Joi.string(),
            logprobs: Joi.string(),
            frequency_penalty: Joi.string(),
            presence_penalty: Joi.string(),
            n: Joi.string(),
            stop: Joi.string(),
            stream: Joi.string(),
            tools: Joi.string(),
            tool_choice: Joi.string(),
            response_format: Joi.string()
          }),
          "gpt-3.5-turbo-16k": Joi.object({
            temperature: Joi.string(),
            max_tokens: Joi.string(),
            top_p: Joi.string(),
            logprobs: Joi.string(),
            frequency_penalty: Joi.string(),
            presence_penalty: Joi.string(),
            n: Joi.string(),
            stop: Joi.string(),
            stream: Joi.string(),
            tools: Joi.string(),
            tool_choice: Joi.string(),
            response_format: Joi.string()
          }),
          "gpt-3.5-turbo-16k-0613": Joi.object({
            temperature: Joi.string(),
            max_tokens: Joi.string(),
            top_p: Joi.string(),
            logprobs: Joi.string(),
            frequency_penalty: Joi.string(),
            presence_penalty: Joi.string(),
            n: Joi.string(),
            stop: Joi.string(),
            stream: Joi.string(),
            tools: Joi.string(),
            tool_choice: Joi.string(),
            response_format: Joi.string()
          }),
          "gpt-4": Joi.object({
            temperature: Joi.string(),
            max_tokens: Joi.string(),
            top_p: Joi.string(),
            logprobs: Joi.string(),
            frequency_penalty: Joi.string(),
            presence_penalty: Joi.string(),
            n: Joi.string(),
            stop: Joi.string(),
            stream: Joi.string(),
            tools: Joi.string(),
            tool_choice: Joi.string()
          }),
          "gpt-4o": Joi.object({
            temperature: Joi.string(),
            max_tokens: Joi.string(),
            top_p: Joi.string(),
            logprobs: Joi.string(),
            frequency_penalty: Joi.string(),
            presence_penalty: Joi.string(),
            n: Joi.string(),
            stop: Joi.string(),
            stream: Joi.string(),
            tools: Joi.string(),
            tool_choice: Joi.string()
          }),
          "chatgpt-4o-latest": Joi.object({
            temperature: Joi.string(),
            max_tokens: Joi.string(),
            top_p: Joi.string(),
            logprobs: Joi.string(),
            frequency_penalty: Joi.string(),
            presence_penalty: Joi.string(),
            n: Joi.string(),
            stop: Joi.string(),
            stream: Joi.string()
          }),
          "gpt-4-0613": Joi.object({
            temperature: Joi.string(),
            max_tokens: Joi.string(),
            top_p: Joi.string(),
            logprobs: Joi.string(),
            frequency_penalty: Joi.string(),
            presence_penalty: Joi.string(),
            n: Joi.string(),
            stop: Joi.string(),
            stream: Joi.string(),
            tools: Joi.string(),
            tool_choice: Joi.string()
          }),
          "gpt-4-1106-preview": Joi.object({
            temperature: Joi.string(),
            max_tokens: Joi.string(),
            top_p: Joi.string(),
            logprobs: Joi.string(),
            frequency_penalty: Joi.string(),
            presence_penalty: Joi.string(),
            n: Joi.string(),
            stop: Joi.string(),
            stream: Joi.string(),
            tools: Joi.string(),
            tool_choice: Joi.string(),
            response_format: Joi.string()
          }),
          "gpt-4-turbo-preview": Joi.object({
            temperature: Joi.string(),
            max_tokens: Joi.string(),
            top_p: Joi.string(),
            logprobs: Joi.string(),
            frequency_penalty: Joi.string(),
            presence_penalty: Joi.string(),
            n: Joi.string(),
            stop: Joi.string(),
            stream: Joi.string(),
            tools: Joi.string(),
            tool_choice: Joi.string(),
            response_format: Joi.string()
          }),
          "gpt-4-0125-preview": Joi.object({
            temperature: Joi.string(),
            max_tokens: Joi.string(),
            top_p: Joi.string(),
            logprobs: Joi.string(),
            frequency_penalty: Joi.string(),
            presence_penalty: Joi.string(),
            n: Joi.string(),
            stop: Joi.string(),
            stream: Joi.string(),
            tools: Joi.string(),
            tool_choice: Joi.string(),
            response_format: Joi.string()
          }),
          "gpt-4-turbo-2024-04-09": Joi.object({
            temperature: Joi.string(),
            max_tokens: Joi.string(),
            top_p: Joi.string(),
            logprobs: Joi.string(),
            frequency_penalty: Joi.string(),
            presence_penalty: Joi.string(),
            n: Joi.string(),
            stop: Joi.string(),
            stream: Joi.string(),
            tools: Joi.string(),
            tool_choice: Joi.string(),
            response_format: Joi.string()
          }),
          "gpt-4-turbo": Joi.object({
            temperature: Joi.string(),
            max_tokens: Joi.string(),
            top_p: Joi.string(),
            logprobs: Joi.string(),
            frequency_penalty: Joi.string(),
            presence_penalty: Joi.string(),
            n: Joi.string(),
            stop: Joi.string(),
            stream: Joi.string(),
            tools: Joi.string(),
            tool_choice: Joi.string(),
            response_format: Joi.string()
          }),
          "text-embedding-3-large": Joi.object({
            encoding_format: Joi.string(),
            dimensions: Joi.string()
          }),
          "text-embedding-3-small": Joi.object({
            encoding_format: Joi.string(),
            dimensions: Joi.string()
          }),
          "text-embedding-ada-002": Joi.object({
            encoding_format: Joi.string(),
            dimensions: Joi.string()
          }),
          "gpt-3.5-turbo-instruct": Joi.object({
            best_of: Joi.string(),
            echo: Joi.string(),
            frequency_penalty: Joi.string(),
            logit_bias: Joi.string(),
            logprobs: Joi.string(),
            max_tokens: Joi.string(),
            n: Joi.string(),
            presence_penalty: Joi.string(),
            seed: Joi.string(),
            stop: Joi.string(),
            stream: Joi.string(),
            suffix: Joi.string(),
            temperature: Joi.string(),
            top_p: Joi.string()
          }),
          "gemini-pro": Joi.object({
            temperature: Joi.string(),
            topK: Joi.string(),
            topP: Joi.string(),
            maxOutputTokens: Joi.string(),
            stopSequences: Joi.string()
          }),
          "gemini-1.0-pro-vision": Joi.object({
            temperature: Joi.string(),
            topK: Joi.string(),
            topP: Joi.string(),
            maxOutputTokens: Joi.string(),
            stopSequences: Joi.string()
          }),
          "gemini-1.0-pro": Joi.object({
            temperature: Joi.string(),
            topK: Joi.string(),
            topP: Joi.string(),
            maxOutputTokens: Joi.string(),
            stopSequences: Joi.string()
          }),
          "gemini-1.5-Flash": Joi.object({
            temperature: Joi.string(),
            topK: Joi.string(),
            topP: Joi.string(),
            maxOutputTokens: Joi.string(),
            stopSequences: Joi.string()
          }),
          "gemini-1.5-pro": Joi.object({
            temperature: Joi.string(),
            topK: Joi.string(),
            topP: Joi.string(),
            maxOutputTokens: Joi.string(),
            stopSequences: Joi.string()
          }),
          "embedding-001": Joi.object({
            temperature: Joi.string(),
            topK: Joi.string(),
            topP: Joi.string(),
            maxOutputTokens: Joi.string(),
            stopSequences: Joi.string()
          })
        }).unknown() // Allow any additional properties within each model's configuration
      })
    }
  )
  .unknown(true);

const createThreadHistrorySchema = Joi.object({
  bridge_id: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .required(),
  org_id: Joi.string().required().messages({
    "string.base": "The org_id must be a string"
  }),
  thread_id: Joi.string().required(),
  sub_thread_id: Joi.string().required(),
  model_name: Joi.string().required(),
  message: Joi.string().required(),
  type: Joi.string().valid("chat").required(),
  message_by: Joi.string().valid("assistant").required(),
  message_id: Joi.string()
}).unknown(true);

export { updateBridgeSchema, createThreadHistrorySchema };
