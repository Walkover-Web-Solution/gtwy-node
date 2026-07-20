import ServiceModel from "../../mongoModel/Service.model.js";

// In-memory registry of the `services` collection, keyed by service_name.
// Refreshed at boot and on every change-stream event. Mirrors the pattern in
// loadModelConfigs.js.
let servicesRegistry = {};

// Hardcoded safety net — mirrors src/configs/service_registry.py::_FALLBACK_REGISTRY
// in the Python repo. Used (merged under live data) so a missing/empty/unseeded
// `services` collection never hard-fails service resolution.
const FALLBACK_SERVICES = {
  openai: {
    service_name: "openai",
    base_url: "https://api.openai.com/v1",
    wire_format: "openai_responses",
    client: "openai_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: true,
    supports_reasoning: true,
    default_model: "gpt-4o",
    prompt_role: "system",
    apikey_status_codes: { invalid: [401], unauthorized: [403], limited: [429] },
    status: 1
  },
  openai_completion: {
    service_name: "openai_completion",
    base_url: null,
    wire_format: "openai_chat",
    client: "openai_completion_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: true,
    supports_reasoning: false,
    default_model: null,
    prompt_role: "system",
    apikey_status_codes: { invalid: [401], unauthorized: [403], limited: [429] },
    status: 1
  },
  gemini: {
    service_name: "gemini",
    base_url: "https://generativelanguage.googleapis.com/v1",
    wire_format: "gemini",
    client: "gemini_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: false,
    supports_reasoning: true,
    default_model: "gemini-2.5-flash",
    prompt_role: "system",
    apikey_status_codes: { invalid: [400], unauthorized: [403], limited: [429] },
    status: 1
  },
  anthropic: {
    service_name: "anthropic",
    base_url: "https://api.anthropic.com/v1",
    wire_format: "anthropic",
    client: "anthropic_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: false,
    supports_reasoning: true,
    default_model: "claude-3-7-sonnet-latest",
    prompt_role: "system",
    apikey_status_codes: { invalid: [401], unauthorized: [403], limited: [429] },
    status: 1
  },
  groq: {
    service_name: "groq",
    base_url: "https://api.groq.com/openai/v1",
    wire_format: "openai_chat",
    client: "groq_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: true,
    supports_reasoning: false,
    default_model: "llama-3.3-70b-versatile",
    prompt_role: "system",
    apikey_status_codes: { invalid: [400, 401], unauthorized: [403], limited: [422, 429, 498] },
    status: 1
  },
  grok: {
    service_name: "grok",
    base_url: "https://api.x.ai/v1",
    wire_format: "openai_chat",
    client: "grok_http",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: true,
    supports_reasoning: false,
    default_model: "grok-4-fast",
    prompt_role: "system",
    apikey_status_codes: { invalid: [400, 401], unauthorized: [403], limited: [429] },
    status: 1
  },
  open_router: {
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
  mistral: {
    service_name: "mistral",
    base_url: "https://api.mistral.ai/v1",
    wire_format: "openai_chat",
    client: "mistral_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: false,
    supports_reasoning: false,
    default_model: "mistral-medium-latest",
    prompt_role: "system",
    apikey_status_codes: { invalid: [401], unauthorized: [403], limited: [429] },
    status: 1
  },
  deepgram: {
    service_name: "deepgram",
    base_url: "https://api.deepgram.com/v1",
    wire_format: "deepgram",
    client: "deepgram_sdk",
    supports_streaming: false,
    supports_tool_calls: false,
    supports_stream_usage: false,
    supports_reasoning: false,
    default_model: "nova-3",
    prompt_role: "system",
    apikey_status_codes: { invalid: [400, 401, 404], unauthorized: [403], limited: [402, 413, 422, 429] },
    status: 1
  },
  neev_cloud: {
    service_name: "neev_cloud",
    base_url: "https://inference.ai.neevcloud.com/v1",
    wire_format: "openai_chat",
    client: "openai_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: false,
    supports_reasoning: false,
    default_model: "gpt-oss-120b",
    prompt_role: "system",
    apikey_status_codes: { invalid: [401], unauthorized: [403], limited: [429] },
    status: 1
  },
  moonshot: {
    service_name: "moonshot",
    base_url: "https://api.moonshot.ai/v1",
    wire_format: "openai_chat",
    client: "openai_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: true,
    supports_reasoning: true,
    default_model: "kimi-k2.6",
    prompt_role: "system",
    apikey_status_codes: { invalid: [401], unauthorized: [403], limited: [429] },
    status: 1
  },
  deepseek: {
    service_name: "deepseek",
    base_url: "https://api.deepseek.com",
    wire_format: "openai_chat",
    client: "openai_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: true,
    supports_reasoning: true,
    default_model: "deepseek-v4-flash",
    prompt_role: "system",
    apikey_status_codes: { invalid: [400, 401], unauthorized: [403], limited: [429] },
    status: 1
  },
  huggingface: {
    service_name: "huggingface",
    base_url: "https://router.huggingface.co/v1",
    wire_format: "openai_chat",
    client: "openai_sdk",
    supports_streaming: true,
    supports_tool_calls: true,
    supports_stream_usage: false,
    supports_reasoning: false,
    default_model: "meta-llama/Llama-3.1-8B-Instruct",
    prompt_role: "system",
    apikey_status_codes: { invalid: [401], unauthorized: [403], limited: [402, 429] },
    status: 1
  }
};

const getServicesRegistry = async () => {
  try {
    const services = await ServiceModel.find({ status: 1 }).lean();
    const formatted = {};
    for (const svc of services) {
      if (svc.service_name) formatted[svc.service_name] = svc;
    }
    return formatted;
  } catch (error) {
    console.error("Error fetching service registry:", error);
    return {};
  }
};

const initServicesRegistry = async () => {
  try {
    const newDocument = await getServicesRegistry();
    for (const key in servicesRegistry) {
      delete servicesRegistry[key];
    }
    Object.assign(servicesRegistry, newDocument);
    console.log(`Service registry refreshed successfully (${Object.keys(servicesRegistry).length} services).`);
  } catch (error) {
    console.error("Error refreshing service registry:", error);
  }
};

const backgroundListenForServiceChanges = async () => {
  try {
    const stream = ServiceModel.watch([{ $match: { operationType: { $in: ["insert", "update", "replace", "delete"] } } }]);

    console.log("MongoDB change stream is now listening for service registry changes.");

    stream.on("change", async (change) => {
      console.log(`Change detected in service registry: ${change.operationType}`);
      await initServicesRegistry();
    });

    stream.on("error", (error) => {
      console.error("Service registry change stream error:", error);
      setTimeout(backgroundListenForServiceChanges, 5000);
    });
  } catch (error) {
    console.error("Error initializing service registry change stream:", error);
    setTimeout(backgroundListenForServiceChanges, 10000);
  }
};

// --- Lookup helpers (live DB merged over hardcoded fallback) ---------------
const getService = (name) => {
  const fallback = FALLBACK_SERVICES[name] || null;
  const live = servicesRegistry[name] || null;
  if (!live && !fallback) return null;
  if (!live) return fallback;
  if (!fallback) return live;
  // live wins, but only for fields it actually provides (non-null/undefined)
  const merged = { ...fallback };
  for (const [k, v] of Object.entries(live)) {
    if (v !== null && v !== undefined) merged[k] = v;
  }
  return merged;
};

const field = (name, key, defaultValue = null) => {
  const svc = getService(name);
  if (!svc) return defaultValue;
  const value = svc[key];
  return value === null || value === undefined ? defaultValue : value;
};

const wireFormat = (name) => field(name, "wire_format");
const client = (name) => field(name, "client");
const getBaseUrl = (name) => field(name, "base_url");
const getDefaultModel = (name) => field(name, "default_model");
const apikeyStatusCodes = (name) => field(name, "apikey_status_codes", {});

// --- Capability predicates (mirror the Python registry) --------------------
const usesOpenAISdk = (name) => client(name) === "openai_sdk" && wireFormat(name) === "openai_chat";
const hasOpenAIChoicesShape = (name) => wireFormat(name) === "openai_chat";

export {
  servicesRegistry,
  FALLBACK_SERVICES,
  initServicesRegistry,
  backgroundListenForServiceChanges,
  getService,
  wireFormat,
  client,
  getBaseUrl,
  getDefaultModel,
  apikeyStatusCodes,
  usesOpenAISdk,
  hasOpenAIChoicesShape
};
