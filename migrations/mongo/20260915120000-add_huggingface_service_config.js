/**
 * Migration: add validation_config and service_keys for the huggingface service.
 *
 * huggingface was seeded into the `services` registry (see
 * 20260606120000-seed_services_registry.js) but was missing from the later
 * validation_config / service_keys backfills (20260723120000-add_service_keys.js),
 * so API-key validation and parameter translation for huggingface fell back to
 * empty defaults. huggingface is openai_chat + openai_sdk, so its config mirrors
 * the other generic OpenAI-compatible services (moonshot, minimax, neev_cloud).
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */

const VALIDATION_CONFIG = {
  method: "GET",
  path: "models",
  headers: { Authorization: "Bearer {apiKey}" }
};

const SERVICE_KEYS = {
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
};

export const up = async (db) => {
  const collection = db.collection("services");
  const result = await collection.updateOne(
    { service_name: "huggingface" },
    { $set: { validation_config: VALIDATION_CONFIG, service_keys: SERVICE_KEYS } }
  );
  console.log(`Added validation_config/service_keys to huggingface: matched ${result.matchedCount}, modified ${result.modifiedCount}.`);
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const collection = db.collection("services");
  const result = await collection.updateOne({ service_name: "huggingface" }, { $unset: { validation_config: "", service_keys: "" } });
  console.log(`Removed validation_config/service_keys from huggingface: modified ${result.modifiedCount}.`);
};
