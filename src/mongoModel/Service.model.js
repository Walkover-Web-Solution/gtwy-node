import mongoose from "mongoose";

// Service capability registry — mirrors the `services` collection seeded by
// migrations/mongo/20260606120000-seed_services_registry.js and the Python
// repo's src/configs/service_registry.py::_FALLBACK_REGISTRY.
const ServiceSchema = new mongoose.Schema(
  {
    service_name: { type: String, required: true, unique: true },
    base_url: { type: String, default: null }, // null => provider SDK default
    wire_format: { type: String, required: true }, // openai_chat | openai_responses | anthropic | gemini | deepgram
    client: { type: String, required: true }, // openai_sdk | groq_sdk | grok_http | mistral_sdk | openai_completion_sdk | anthropic_sdk | gemini_sdk | deepgram_sdk | minimax_sdk
    supports_streaming: { type: Boolean, default: false },
    supports_tool_calls: { type: Boolean, default: false },
    supports_stream_usage: { type: Boolean, default: false },
    supports_reasoning: { type: Boolean, default: false },
    supports_batch: { type: Boolean, default: false },
    supports_embeddings: { type: Boolean, default: false },
    supports_image_gen: { type: Boolean, default: false },
    supports_video: { type: Boolean, default: false },
    reasoning_param_style: { type: String, default: null }, // summary_flag | thinking_config | output_config_effort | reasoning_effort | reasoning_effort_extra_body | null
    extra_body: { type: mongoose.Schema.Types.Mixed, default: {} }, // static params always merged into the request's extra_body for this service
    reasoning_extra_body: { type: mongoose.Schema.Types.Mixed, default: {} }, // extra_body params merged in only when reasoning is enabled
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
