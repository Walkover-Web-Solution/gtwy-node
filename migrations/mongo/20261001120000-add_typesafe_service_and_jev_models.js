/**
 * Migration: register the TypeSafe (Jev) service and its models.
 *
 * Jev is a "System One" model, not a chat model: the request is
 * { model, state, questions } and the response is { model, answers, usage }.
 * The Python gateway has a dedicated handler/runner for wire_format "typesafe"
 * (src/services/commonServices/typesafe/). `questions` is a level-0 model
 * parameter so it is forwarded only when a request sends
 * configuration.questions, and is never rendered in the UI.
 *
 * Pricing from https://docs.typesafe.ai/models: $0.042 per 1M input tokens,
 * output free. Idempotent: upserts by service_name / (service, model_name).
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */

const SERVICE = {
  service_name: "typesafe",
  base_url: "https://api.typesafe.ai/v1",
  wire_format: "typesafe",
  client: "typesafe_http",
  supports_streaming: false,
  supports_tool_calls: false,
  supports_stream_usage: false,
  supports_reasoning: false,
  reasoning_param_style: null,
  extra_body: {},
  reasoning_extra_body: {},
  default_model: "jev-latest",
  default_fallback_model: "jev-1.13.0",
  prompt_role: "system",
  apikey_status_codes: { invalid: [401], unauthorized: [403], limited: [429] },
  validation_config: { method: "GET", path: "models", headers: { Authorization: "Bearer {apiKey}" } },
  service_keys: { default: { model: "model", state: "state", questions: "questions" } },
  status: 1
};

const JEV_PRICING = { input_cost: 0.042, output_cost: 0, cached_cost: 0 };

const JEV_SPECIFICATION = {
  ...JEV_PRICING,
  description:
    "TypeSafe Jev 1.13 System One model. Evaluates typed questions (choice, score, noul) against a state and returns calibrated answers with probabilities and confidence. Not a text generator: send the input as the user message and the questions as configuration.questions.",
  knowledge_cutoff: "",
  usecase: [
    "Classification and intent routing",
    "Scoring against a rubric",
    "Yes/no checks with a probability",
    "Guardrails, validation and re-ranking"
  ]
};

const buildModel = (modelName, displayName) => ({
  service: "typesafe",
  model_name: modelName,
  display_name: displayName,
  status: 1,
  configuration: {
    model: { field: "drop", default: modelName, level: 1 },
    questions: {
      field: "json",
      typeOf: "object",
      default: {},
      level: 0,
      name: "Questions",
      description:
        "Map of typed questions sent per request as configuration.questions. Each entry: { type: 'choice' | 'score' | 'noul', instructions, criteria? }."
    }
  },
  validationConfig: {
    type: "chat",
    system_prompt: false,
    tools: false,
    vision: false,
    files: false,
    context_window: 64000,
    specification: JEV_SPECIFICATION,
    inbuilt_tools: { image_generation: false, web_search: false, Gtwy_Web_Search: false }
  },
  outputConfig: {
    message: "answers",
    tools: "",
    annotations: "",
    id: "request_id",
    usage: [{ total_tokens: "usage.input_tokens", total_cost: JEV_PRICING }]
  }
});

const MODELS = [buildModel("jev-latest", "Jev (latest)"), buildModel("jev-1.13.0", "Jev 1.13")];

export const up = async (db) => {
  const now = new Date();

  const serviceResult = await db.collection("services").updateOne({ service_name: SERVICE.service_name }, { $set: SERVICE }, { upsert: true });
  console.log(`[typesafe] service ${serviceResult.upsertedCount ? "inserted" : serviceResult.modifiedCount ? "updated" : "unchanged"}.`);

  const modelOps = MODELS.map((model) => ({
    updateOne: {
      filter: { service: model.service, model_name: model.model_name },
      update: {
        $set: { ...model, updated_at: now },
        $setOnInsert: { created_at: now }
      },
      upsert: true
    }
  }));
  const modelResult = await db.collection("modelconfigurations").bulkWrite(modelOps, { ordered: false });
  console.log(`[typesafe] models: ${modelResult.upsertedCount} inserted, ${modelResult.modifiedCount} updated, ${MODELS.length} total.`);
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  await db.collection("modelconfigurations").deleteMany({ service: "typesafe" });
  await db.collection("services").deleteMany({ service_name: "typesafe" });
};
