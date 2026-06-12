/**
 * Migration: seed the `services` registry collection.
 *
 * Populates per-service capability metadata (base_url, wire_format, client,
 * default model, api-key status codes) so that onboarding a new
 * OpenAI-Chat-Completions-compatible service becomes a single DB insert.
 *
 * Source of truth mirrors src/configs/service_registry.py::_FALLBACK_REGISTRY
 * in the AI-middleware-python repo. Idempotent: upserts by service_name.
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
const SERVICES = [
  {
    service_name: "openai",
    base_url: null,
    wire_format: "openai_responses",
    client: "openai_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: true,
    supports_reasoning: true,
    default_model: "gpt-4o",
    apikey_status_codes: { invalid: [401], unauthorized: [403], limited: [429] },
    status: 1
  },
  {
    service_name: "openai_completion",
    base_url: null,
    wire_format: "openai_chat",
    client: "openai_completion_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: true,
    supports_reasoning: false,
    default_model: null,
    apikey_status_codes: { invalid: [401], unauthorized: [403], limited: [429] },
    status: 1
  },
  {
    service_name: "gemini",
    base_url: null,
    wire_format: "gemini",
    client: "gemini_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: false,
    supports_reasoning: true,
    default_model: "gemini-2.5-flash",
    apikey_status_codes: { invalid: [400], unauthorized: [403], limited: [429] },
    status: 1
  },
  {
    service_name: "anthropic",
    base_url: null,
    wire_format: "anthropic",
    client: "anthropic_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: false,
    supports_reasoning: true,
    default_model: "claude-3-7-sonnet-latest",
    apikey_status_codes: { invalid: [401], unauthorized: [403], limited: [429] },
    status: 1
  },
  {
    service_name: "groq",
    base_url: null,
    wire_format: "openai_chat",
    client: "groq_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: true,
    supports_reasoning: false,
    default_model: "llama-3.3-70b-versatile",
    apikey_status_codes: { invalid: [400, 401], unauthorized: [403], limited: [422, 429, 498] },
    status: 1
  },
  {
    service_name: "grok",
    base_url: "https://api.x.ai/v1",
    wire_format: "openai_chat",
    client: "grok_http",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: true,
    supports_reasoning: false,
    default_model: "grok-4-fast",
    apikey_status_codes: { invalid: [400, 401], unauthorized: [403], limited: [429] },
    status: 1
  },
  {
    service_name: "open_router",
    base_url: "https://openrouter.ai/api/v1",
    wire_format: "openai_chat",
    client: "openai_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: false,
    supports_reasoning: false,
    default_model: "deepseek/deepseek-chat-v3-0324:free",
    prompt_role: "developer",
    apikey_status_codes: { invalid: [401], unauthorized: [403], limited: [402, 429] },
    status: 1
  },
  {
    service_name: "mistral",
    base_url: null,
    wire_format: "openai_chat",
    client: "mistral_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: false,
    supports_reasoning: false,
    default_model: "mistral-medium-latest",
    apikey_status_codes: { invalid: [401], unauthorized: [403], limited: [429] },
    status: 1
  },
  {
    service_name: "deepgram",
    base_url: null,
    wire_format: "deepgram",
    client: "deepgram_sdk",
    supports_streaming: false,
    supports_tool_calls: false,
    supports_stream_usage: false,
    supports_reasoning: false,
    default_model: "nova-3",
    apikey_status_codes: { invalid: [400, 401, 404], unauthorized: [403], limited: [402, 413, 422, 429] },
    status: 1
  },
  {
    service_name: "neev_cloud",
    base_url: "https://inference.ai.neevcloud.com/v1",
    wire_format: "openai_chat",
    client: "openai_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: false,
    supports_reasoning: false,
    default_model: "gpt-oss-120b",
    apikey_status_codes: { invalid: [401], unauthorized: [403], limited: [429] },
    status: 1
  },
  {
    service_name: "moonshot",
    base_url: "https://api.moonshot.ai/v1",
    wire_format: "openai_chat",
    client: "openai_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: true,
    supports_reasoning: true,
    default_model: "kimi-k2.6",
    apikey_status_codes: { invalid: [401], unauthorized: [403], limited: [429] },
    status: 1
  },
  {
    // deepseek: openai_chat + openai_sdk -> routes through the generic AsyncOpenAI
    // runner. Old per-service stream combined content+reasoning into one yield;
    // generic runner emits them separately (final accumulated response identical).
    service_name: "deepseek",
    base_url: "https://api.deepseek.com",
    wire_format: "openai_chat",
    client: "openai_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: true,
    supports_reasoning: true,
    default_model: "deepseek-v4-flash",
    apikey_status_codes: { invalid: [400, 401], unauthorized: [403], limited: [429] },
    status: 1
  }
];

export const up = async (db) => {
  const collection = db.collection("services");
  await collection.createIndex({ service_name: 1 }, { unique: true });

  const operations = SERVICES.map((svc) => ({
    updateOne: {
      filter: { service_name: svc.service_name },
      update: { $set: svc },
      upsert: true
    }
  }));

  const result = await collection.bulkWrite(operations, { ordered: false });
  console.log(`Seeded services registry: ${result.upsertedCount} inserted, ${result.modifiedCount} updated, ${SERVICES.length} total.`);
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const names = SERVICES.map((s) => s.service_name);
  await db.collection("services").deleteMany({ service_name: { $in: names } });
};
