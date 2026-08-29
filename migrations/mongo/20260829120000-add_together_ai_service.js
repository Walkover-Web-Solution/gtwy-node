/**
 * Migration: register `together_ai` in the `services` registry collection.
 *
 * Together AI exposes an OpenAI-Chat-Completions-compatible API, so it needs no
 * provider-specific runner: `client: "openai_sdk"` + `wire_format: "openai_chat"`
 * routes it through the shared AsyncOpenAI runner in the Python middleware and
 * through the existing openai-compatible helpers here.
 *
 * Capability notes:
 * - supports_stream_usage is false: `stream_options.include_usage` is not part of
 *   Together's documented request schema, so the runner must not send it.
 * - supports_reasoning is true: Together returns `reasoning_content` on both the
 *   assistant message and the streamed delta for reasoning models.
 *
 * Idempotent: upserts by service_name.
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */

const TOGETHER_AI = {
  service_name: "together_ai",
  base_url: "https://api.together.ai/v1",
  wire_format: "openai_chat",
  client: "openai_sdk",
  supports_streaming: true,
  supports_tool_calls: true,
  supports_stream_usage: false,
  supports_reasoning: true,
  default_model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  default_fallback_model: "openai/gpt-oss-20b",
  prompt_role: "system",
  apikey_status_codes: { invalid: [401], unauthorized: [403], limited: [429] },
  service_keys: {
    default: {
      creativity_level: "temperature",
      probability_cutoff: "top_p",
      repetition_penalty: "frequency_penalty",
      novelty_penalty: "presence_penalty",
      log_probability: "logprobs",
      echo_input: "echo",
      input_text: "input",
      token_selection_limit: "topK",
      response_count: "n",
      additional_stop_sequences: "stopSequences",
      best_response_count: "best_of",
      response_suffix: "suffix",
      response_type: "response_format",
      max_tokens: "max_tokens"
    }
  },
  validation_config: {
    method: "GET",
    path: "models",
    headers: { Authorization: "Bearer {apiKey}" }
  },
  status: 1
};

export const up = async (db) => {
  const collection = db.collection("services");

  const result = await collection.updateOne({ service_name: TOGETHER_AI.service_name }, { $set: TOGETHER_AI }, { upsert: true });

  console.log(`Registered together_ai service: ${result.upsertedCount} inserted, ${result.modifiedCount} updated.`);
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const result = await db.collection("services").deleteOne({ service_name: TOGETHER_AI.service_name });
  console.log(`Removed together_ai service: ${result.deletedCount} deleted.`);
};
