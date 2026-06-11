import mongoose from "mongoose";

// Service capability registry — mirrors the `services` collection seeded by
// migrations/mongo/20260606120000-seed_services_registry.js and the Python
// repo's src/configs/service_registry.py::_FALLBACK_REGISTRY.
const ServiceSchema = new mongoose.Schema(
  {
    service_name: { type: String, required: true, unique: true },
    base_url: { type: String, default: null }, // null => provider SDK default
    wire_format: { type: String, required: true }, // openai_chat | openai_responses | anthropic | gemini | deepgram
    client: { type: String, required: true }, // openai_sdk | groq_sdk | grok_http | mistral_sdk | openai_completion_sdk | anthropic_sdk | gemini_sdk | deepgram_sdk
    supports_streaming: { type: Boolean, default: false },
    supports_tool_calls: { type: Boolean, default: false },
    supports_stream_usage: { type: Boolean, default: false },
    supports_reasoning: { type: Boolean, default: false },
    default_model: { type: String, default: null },
    prompt_role: { type: String, default: "system" },
    apikey_status_codes: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: Number, default: 1 }
  },
  { strict: true }
);

// Explicit collection name so it binds to the seeded `services` collection.
const ServiceModel = mongoose.model("Service", ServiceSchema, "services");
export default ServiceModel;
