---
name: version-config
description: Reference for the GTWY agent version configuration accepted by PUT /api/versions/:version_id. Use when building, editing, reviewing, or debugging a version/bridge config payload, when a user asks which keys a version accepts (configuration, settings, agents, functions, guardrails, fallback, MCP servers), or when a version update fails Joi validation.
---

# GTWY Version Config

An agent **version** is a Mongo document (`configuration_versions`) that holds the full
runtime setup of an agent: provider, model, model parameters, prompt, tools, connected
agents, guardrails, fallback and delivery settings. Versions are edited via
`PUT /api/versions/:version_id` and validated by `updateVersionSchema`.

Source of truth (read these when in doubt, the schema evolves):

- Validator: `src/validation/joi_validation/bridgeVersion.validation.js`
- Mongo model and defaults: `src/mongoModel/BridgeVersion.model.js`
- Parameter transform middleware: `src/services/utils/advancedParam.utils.js`
- Routes: `src/routes/agentVersion.routes.js` (mounted at `/api/versions`)

## Rules

1. **Every key is optional.** Send only what you want to change. Unknown top-level keys
   are rejected by Joi.
2. **`service` must be an active service name** from the services registry
   (e.g. `openai`, `openai_completion`, `anthropic`, `gemini`, `groq`, `grok`, `mistral`,
   `deepseek`, `open_router`, `minimax`, `moonshot`, `neev_cloud`, `deepgram`).
3. **All ids are 24-char hex ObjectIds**: `apikey_object_id` values, `function_ids`,
   `functionData.function_id`, `agents.connected_agents.*.bridge_id` / `version_id`.
4. **`configuration` parameters are stored in `{mode, value}` form.** The middleware
   `transformAgentAdvanceParametersMiddleware` converts what you send:
   - a number, string, boolean or array becomes `{ "mode": "custom", "value": <sent> }`
   - the literal strings `"default"`, `"min"`, `"max"` become `{ "mode": "<that>", "value": null }`
   - `null` becomes `{ "mode": "default", "value": null }`
   - an object that already has `mode` is stored as-is
   - `prompt`, `model`, `type`, `is_rich_text`, `mcp_config`, `system_prompt_version_id`
     are never transformed
   Responses are converted back to plain values, so clients normally send plain scalars.
5. **Operation flags are strings**: `"1"` = add/connect, `"0"` = remove/disconnect
   (`functionData.function_operation`, `built_in_tools_data.built_in_tools_operation`,
   `agents.agent_status`).
6. **`settings.maximum_iterations` minimum is 3.**
7. **Server-managed fields are rejected on update**: `org_id`, `user_id`, `is_drafted`,
   `parent_id`, `published_version_id`, `total_tokens`, `ai_updates`, `created_at`,
   `updatedAt`, `deletedAt`, `hello_id`, `folder_id`, `apikey`.
8. Publishing, discarding and deleting need an admin role (`requireAdminRole`).

## Related endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/versions/:version_id` | Fetch a version |
| PUT | `/api/versions/:version_id` | Update (body below) |
| POST | `/api/versions/publish/:version_id` | Publish draft to live |
| POST | `/api/versions/discard/:version_id` | Discard draft changes |
| DELETE | `/api/versions/:version_id` | Soft-delete (30-day TTL) |
| GET | `/api/versions/suggest-model/:version_id` | Model suggestion |
| GET | `/api/versions/connected-agents/:version_id` | List connected agents |

## Full accepted body (annotated)

Comments explain each key. Strip them before sending. Values shown are examples.

```jsonc
{
  // ---------- Top-level version fields ----------
  "service": "openai",                 // AI provider; must be an active service name
  "apikey_object_id": {                // service name -> API key document id
    "openai": "665f1c2e9b1d4a3f8c7e1234"
  },
  "user_reference": "",                // Free-text reference attached to the version
  "version_description": "",           // Human-readable description of this version
  "gpt_memory": false,                 // Enable long-term memory for this agent
  "gpt_memory_context": "",            // Seed/context text for the memory feature
  "doc_ids": [{ "id": "doc_1" }],      // Knowledge-base documents (RAG); array of objects
  "IsstarterQuestionEnable": false,    // Show starter questions in the chatbot UI
  "starterQuestion": ["How can I help?"], // Starter question strings
  "auto_model_select": null,           // Auto model-selection rules object, or null to disable
  "cache_on": false,                   // Cache identical prompt/response pairs
  "pre_tools": [],                     // Tools to run before the model call
  "post_tool": {                       // Single tool run after the model responds, or null
    "id": "665f1c2e9b1d4a3f8c7e5678",  // Required when post_tool is an object
    "script_id": "script_abc",         // Optional script identifier
    "args": {}                         // Optional arguments passed to the tool
  },
  "web_search_filters": ["example.com"],      // Domain filters for provider-native web search
  "gtwy_web_search_filters": ["example.com"], // Domain filters for GTWY built-in web search
  "connected_agent_flow": {},          // Free-form connected-agent flow/graph
  "variables_path": {},                // Variable name -> JSON path in incoming payloads
  "variables_state": {},               // Current variable values/state
  "embed_override": {},                // Overrides applied when the agent is embedded

  // ---------- Model configuration ----------
  "configuration": {
    "model": "gpt-4o",                 // Model name for the chosen service
    "type": "chat",                    // chat | embedding | fine-tune | reasoning | image
    "prompt": "You are a helpful assistant.", // System prompt (string or object)
    "input": "",                       // Input text for embedding/completion types
    "fine_tune_model": "",             // Fine-tuned model reference
    "response_format": { "type": "text" }, // Provider response format (text / json_object / json_schema)
    "response_type": { "type": "text" },   // Alternative response type field for some services
    "is_rich_text": false,             // Answer in rich text / markdown
    "temperature": 1,                  // Sampling temperature
    "max_tokens": 4096,                // Max output tokens
    "top_p": 1,                        // Nucleus sampling
    "frequency_penalty": 0,            // Penalise repeated tokens by frequency
    "presence_penalty": 0,             // Penalise tokens already present
    "stop": [],                        // Stop sequence(s): string, array, or object
    "additional_stop_sequences": [],   // Extra stop sequences (some providers)
    "stream": false,                   // Stream the response
    "tools": [],                       // Tool/function definitions
    "tool_choice": "auto",             // auto | none | required | { specific tool }
    "parallel_tool_calls": true,       // Allow multiple tool calls in one turn
    "reasoning": { "effort": "medium" }, // Reasoning settings for reasoning models
    "verbosity": "medium",             // Output verbosity hint
    "n": 1,                            // Number of completions
    "logprobs": 0,                     // Number of log-probabilities to return
    "log_probability": false,          // Toggle log-probability output
    "echo_input": false,               // Echo the prompt in the completion
    "RTLayer": null,                   // Send the response through RTLayer
    "webhook": "",                     // Webhook URL to POST the response to

    // Provider-neutral aliases used by some services
    "creativity_level": 1,             // Alias for temperature
    "token_selection_limit": 40,       // Alias for top_k
    "response_count": 1,               // Alias for n
    "best_response_count": 1,          // Alias for best_of
    "novelty_penalty": 0,              // Alias for presence_penalty
    "repetition_penalty": 1,           // Repetition penalty
    "probability_cutoff": 1,           // Alias for top_p
    "response_suffix": "",             // Text appended after the completion

    // Image generation (type = image)
    "image_size": "1024x1024",         // Image dimensions
    "size": "1024x1024",               // Alternative size field
    "number_of_images": 1,             // How many images to generate
    "aspect_ratio": "1:1",             // Aspect ratio
    "dimensions": "",                  // Dimension spec for some providers
    "quality": "standard",             // standard | hd
    "style": "vivid",                  // vivid | natural

    // Speech-to-text (e.g. deepgram)
    "language": "en",                  // Transcription language
    "smart_format": true,              // Smart formatting
    "detect_language": false,          // Auto-detect language
    "diarize": false,                  // Speaker diarization
    "filler_words": false,             // Keep filler words
    "punctuate": true,                 // Add punctuation
    "numerals": true,                  // Convert numbers to numerals
    "detect_entities": false,          // Entity detection
    "model_option": "",                // Provider-specific model variant

    // MCP servers
    "mcp_config": {
      "servers": [
        { "name": "my-server", "url": "https://mcp.example.com" } // both required, url must be a valid URI
      ]
    }
  },

  // ---------- Agent settings ----------
  "settings": {
    "maximum_iterations": 3,           // Max tool-call loop iterations; minimum 3
    "review_agent": {
      "reviewer_enabled": false,       // Enable a reviewer agent that checks responses
      "reviewer_agent": null,          // Bridge/agent id used as reviewer
      "reviewer_prompt": "",           // Prompt for the reviewer
      "reviewer_tools": []             // Tool names the reviewer may use
    },
    "publicUsers": [],                 // User ids with public (read) access
    "editAccess": [],                  // User ids allowed to edit
    "responseStyle": {},               // Response style selection
    "responseStylePrompt": "",         // Prompt text derived from responseStyle
    "tone": {},                        // Tone selection
    "tonePrompt": "",                  // Prompt text derived from tone
    "response_format": {               // Where to deliver the final response
      "type": "default",               // default (API response) | RTLayer | webhook
      "cred": {}                       // RTLayer: { "apikey" }; webhook: { "url", "headers" }
    },
    "fall_back": {
      "is_enable": false,              // Fall back to another model if the primary fails
      "service": "",                   // Fallback service name
      "model": ""                      // Fallback model name
    },
    "guardrails": {
      "is_enabled": false,             // Enable guardrail checks
      "guardrails_configuration": {},  // Guardrail rule configuration
      "guardrails_custom_prompt": ""   // Custom guardrail prompt
    }
  },

  // ---------- Tools / functions ----------
  "function_ids": ["665f1c2e9b1d4a3f8c7e9999"], // Attached function ids
  "functionData": {                    // Add or remove a single function
    "function_id": "665f1c2e9b1d4a3f8c7e9999",
    "function_operation": "1",         // "1" add, "0" remove
    "script_id": "script_abc"
  },
  "built_in_tools_data": {             // Add or remove a built-in tool
    "built_in_tools": "web_search",    // Built-in tool name
    "built_in_tools_operation": "1"    // "1" add, "0" remove
  },

  // ---------- Connected agents ----------
  "agents": {
    "connected_agents": {
      "Support Agent": {               // Key is the connected agent's display name
        "bridge_id": "665f1c2e9b1d4a3f8c7e0001",
        "version_id": "665f1c2e9b1d4a3f8c7e0002",
        "thread_id": false,            // Share the thread with the connected agent
        "environment": "prod"          // Environment to call
      }
    },
    "agent_status": "1"                // "1" connect, "0" disconnect
  },
  "agent_info": {
    "prompt_total_tokens": 0,          // Token count of the prompt, min 0
    "description": "",                 // Agent description
    "agent_variables": {
      "fields": {},                    // Variable definitions
      "required": []                   // Required variable names
    },
    "thread_id": false,                // Whether the agent uses threads
    "variables_state": {}              // Variable state snapshot
  }
}
```

## Defaults on a new version

From `BridgeVersion.model.js`: `settings` starts with `maximum_iterations: 3`,
`response_format: { type: "default", cred: {} }`, guardrails disabled, fallback disabled,
empty `responseStyle`/`tone`. `configuration` starts as `{}`; `gpt_memory`, `cache_on`,
`IsstarterQuestionEnable` start `false`.

## Minimal examples

Change model and temperature:

```json
{ "service": "openai", "configuration": { "model": "gpt-4o-mini", "temperature": 0.2 } }
```

Attach a function and enable fallback:

```json
{
  "functionData": { "function_id": "665f1c2e9b1d4a3f8c7e9999", "function_operation": "1" },
  "settings": { "fall_back": { "is_enable": true, "service": "anthropic", "model": "claude-sonnet-5" } }
}
```

## Adding a new key

1. Add it to `updateVersionSchema` in `bridgeVersion.validation.js` (use the
   `Joi.alternatives().try(<scalar>, Joi.string(), Joi.object())` pattern for configuration
   parameters so both plain and `{mode, value}` forms validate).
2. Add a default to `BridgeVersion.model.js` if it needs one.
3. If it must not be wrapped in `{mode, value}`, add it to `SKIP_KEYS` in
   `advancedParam.utils.js`.
4. Update the annotated body in this skill.
