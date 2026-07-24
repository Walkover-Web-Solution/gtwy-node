/**
 * Migration: Add service_keys mapping to services collection
 *
 * Adds service_keys field to each service document to map generic parameter names
 * to service-specific API parameter names. This enables parameter translation
 * when making requests to different AI service providers.
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */

const SERVICE_KEYS = {
  openai: {
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
      response_type: "text",
      max_tokens: "max_output_tokens"
    }
  },
  anthropic: {
    default: {
      creativity_level: "temperature",
      probability_cutoff: "top_p",
      token_selection_limit: "top_k",
      additional_stop_sequences: "stop_sequence",
      max_tokens: "max_tokens",
      response_type: "output_config"
    }
  },
  grok: {
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
      response_type: "response_format"
    }
  },
  deepseek: {
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
  groq: {
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
      response_type: "response_format"
    }
  },
  openai_completion: {
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
      max_tokens: "max_completion_tokens"
    }
  },
  open_router: {
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
  neev_cloud: {
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
  moonshot: {
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
  minimax: {
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
  mistral: {
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
  gemini: {
    default: {
      creativity_level: "temperature",
      probability_cutoff: "top_p",
      repetition_penalty: "frequency_penalty",
      novelty_penalty: "presence_penalty",
      token_selection_limit: "top_k",
      response_count: "candidate_count",
      additional_stop_sequences: "stop_sequences",
      response_type: "response_mime_type",
      max_tokens: "max_output_tokens"
    }
  },
  deepgram: {
    default: {
      model: "model",
      language: "language",
      smart_format: "smart_format",
      detect_language: "detect_language",
      diarize: "diarize",
      filler_words: "filler_words",
      punctuate: "punctuate",
      numerals: "numerals",
      detect_entities: "detect_entities",
      model_option: "model_option"
    }
  }
};

export const up = async (db) => {
  const collection = db.collection("services");

  const operations = Object.entries(SERVICE_KEYS).map(([serviceName, keys]) => ({
    updateOne: {
      filter: { service_name: serviceName, service_keys: { $exists: false } },
      update: { $set: { service_keys: keys } }
    }
  }));

  // Add default_fallback_model updates
  const fallbackModelUpdates = [
    { updateOne: { filter: { service_name: "openai" }, update: { $set: { default_fallback_model: "gpt-4.1-mini" } } } },
    { updateOne: { filter: { service_name: "anthropic" }, update: { $set: { default_fallback_model: "claude-haiku-4-5-20251001" } } } },
    { updateOne: { filter: { service_name: "groq" }, update: { $set: { default_fallback_model: "llama-3.3-70b-versatile" } } } },
    { updateOne: { filter: { service_name: "open_router" }, update: { $set: { default_fallback_model: "deepseek/deepseek-chat-v3-0324:free" } } } },
    { updateOne: { filter: { service_name: "mistral" }, update: { $set: { default_fallback_model: "codestral-latest" } } } },
    { updateOne: { filter: { service_name: "gemini" }, update: { $set: { default_fallback_model: "gemini-2.5-flash" } } } },
    { updateOne: { filter: { service_name: "grok" }, update: { $set: { default_fallback_model: "grok-4-fast-reasoning" } } } },
    { updateOne: { filter: { service_name: "deepseek" }, update: { $set: { default_fallback_model: "deepseek-v4-pro" } } } },
    { updateOne: { filter: { service_name: "deepgram" }, update: { $set: { default_fallback_model: "nova-2" } } } },
    { updateOne: { filter: { service_name: "neev_cloud" }, update: { $set: { default_fallback_model: "gpt-oss-120b" } } } },
    { updateOne: { filter: { service_name: "moonshot" }, update: { $set: { default_fallback_model: "kimi-k2.5" } } } },
    { updateOne: { filter: { service_name: "minimax" }, update: { $set: { default_fallback_model: "minimax-m2" } } } }
  ];

  operations.push(...fallbackModelUpdates);

  // Add base_url updates for services that are missing it or have null
  const baseUrlUpdates = [
    { updateOne: { filter: { service_name: "openai", base_url: null }, update: { $set: { base_url: "https://api.openai.com/v1" } } } },
    { updateOne: { filter: { service_name: "anthropic", base_url: null }, update: { $set: { base_url: "https://api.anthropic.com/v1" } } } },
    { updateOne: { filter: { service_name: "groq", base_url: null }, update: { $set: { base_url: "https://api.groq.com/openai/v1" } } } },
    { updateOne: { filter: { service_name: "open_router", base_url: null }, update: { $set: { base_url: "https://openrouter.ai/api/v1" } } } },
    { updateOne: { filter: { service_name: "mistral", base_url: null }, update: { $set: { base_url: "https://api.mistral.ai/v1" } } } },
    {
      updateOne: {
        filter: { service_name: "gemini", base_url: null },
        update: { $set: { base_url: "https://generativelanguage.googleapis.com/v1beta" } }
      }
    },
    { updateOne: { filter: { service_name: "grok", base_url: null }, update: { $set: { base_url: "https://api.x.ai/v1" } } } },
    { updateOne: { filter: { service_name: "deepseek", base_url: null }, update: { $set: { base_url: "https://api.deepseek.com/v1" } } } },
    { updateOne: { filter: { service_name: "deepgram", base_url: null }, update: { $set: { base_url: "https://api.deepgram.com/v1" } } } },
    { updateOne: { filter: { service_name: "neev_cloud", base_url: null }, update: { $set: { base_url: "https://api.neevcloud.com/v1" } } } },
    { updateOne: { filter: { service_name: "moonshot", base_url: null }, update: { $set: { base_url: "https://api.moonshot.cn/v1" } } } },
    { updateOne: { filter: { service_name: "minimax", base_url: null }, update: { $set: { base_url: "https://api.minimax.io/v1" } } } }
  ];

  operations.push(...baseUrlUpdates);

  // Add validation_config field with method, path, headers, and query_param
  const validationConfigUpdates = [
    {
      updateOne: {
        filter: { service_name: "openai" },
        update: { $set: { validation_config: { method: "GET", path: "models", headers: { Authorization: "Bearer {apiKey}" } } } }
      }
    },
    {
      updateOne: {
        filter: { service_name: "anthropic" },
        update: {
          $set: { validation_config: { method: "GET", path: "models", headers: { "x-api-key": "{apiKey}", "anthropic-version": "2023-06-01" } } }
        }
      }
    },
    {
      updateOne: {
        filter: { service_name: "groq" },
        update: {
          $set: {
            validation_config: {
              method: "POST",
              path: "chat/completions",
              headers: { Authorization: "Bearer {apiKey}", "Content-Type": "application/json" }
            }
          }
        }
      }
    },
    {
      updateOne: {
        filter: { service_name: "open_router" },
        update: { $set: { validation_config: { method: "GET", path: "key", headers: { Authorization: "Bearer {apiKey}" } } } }
      }
    },
    {
      updateOne: {
        filter: { service_name: "mistral" },
        update: {
          $set: {
            validation_config: {
              method: "POST",
              path: "chat/completions",
              headers: { Authorization: "Bearer {apiKey}", "Content-Type": "application/json" }
            }
          }
        }
      }
    },
    {
      updateOne: {
        filter: { service_name: "gemini" },
        update: {
          $set: { validation_config: { method: "GET", path: "models", headers: { "Content-Type": "application/json" }, query_param: "key" } }
        }
      }
    },
    {
      updateOne: {
        filter: { service_name: "grok" },
        update: { $set: { validation_config: { method: "GET", path: "models", headers: { Authorization: "Bearer {apiKey}" } } } }
      }
    },
    {
      updateOne: {
        filter: { service_name: "deepseek" },
        update: {
          $set: {
            validation_config: {
              method: "POST",
              path: "chat/completions",
              headers: { Authorization: "Bearer {apiKey}", "Content-Type": "application/json" }
            }
          }
        }
      }
    },
    {
      updateOne: {
        filter: { service_name: "deepgram" },
        update: { $set: { validation_config: { method: "GET", path: "projects", headers: { Authorization: "Token {apiKey}" } } } }
      }
    },
    {
      updateOne: {
        filter: { service_name: "neev_cloud" },
        update: {
          $set: {
            validation_config: {
              method: "POST",
              path: "chat/completions",
              headers: { Authorization: "Bearer {apiKey}", "Content-Type": "application/json" }
            }
          }
        }
      }
    },
    {
      updateOne: {
        filter: { service_name: "moonshot" },
        update: { $set: { validation_config: { method: "GET", path: "models", headers: { Authorization: "Bearer {apiKey}" } } } }
      }
    },
    {
      updateOne: {
        filter: { service_name: "minimax" },
        update: { $set: { validation_config: { method: "GET", path: "models", headers: { Authorization: "Bearer {apiKey}" } } } }
      }
    },
    {
      updateOne: {
        filter: { service_name: "openai_completion" },
        update: {
          $set: {
            validation_config: {
              method: "POST",
              path: "chat/completions",
              headers: { Authorization: "Bearer {apiKey}", "Content-Type": "application/json" }
            }
          }
        }
      }
    }
  ];
  console.log("Adding validation_config updates:", validationConfigUpdates.length);

  operations.push(...validationConfigUpdates);

  const result = await collection.bulkWrite(operations, { ordered: false });
  console.log(`Added service_keys to ${result.modifiedCount} services.`);
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const collection = db.collection("services");
  const names = Object.keys(SERVICE_KEYS);
  const result = await collection.updateMany({ service_name: { $in: names } }, { $unset: { service_keys: "" } });
  console.log(`Removed service_keys from ${result.modifiedCount} services.`);
};
