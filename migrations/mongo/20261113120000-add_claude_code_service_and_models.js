/**
 * Migration: register the `claude_code` service and its models.
 *
 * `claude_code` runs Anthropic models through the Claude Code CLI, signed in with the org's own
 * Claude login (the token `claude setup-token` prints) instead of an Anthropic API key. The Python
 * gateway makes the calls (src/services/commonServices/anthropic/claude_code_session.py); the
 * request and response keep the anthropic wire format, so the service and its models are copies
 * of the anthropic ones with these differences:
 *
 * - No key check against api.anthropic.com: a Claude login is checked by the gateway
 *   (POST /api/v2/model/claude_code/verify), see claudeCode.utils.js.
 * - No Anthropic server tools: native web search and server-side MCP are switched off
 *   (MCP servers run client-side in the gateway).
 * - No batch prices: the Batch API needs an API key.
 *
 * It copies whatever anthropic service and active chat models exist when it runs, so run it again
 * (or add the model by hand) after a new Anthropic model is registered. Idempotent: upserts by
 * service_name / (service, model_name).
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */

const SOURCE = "anthropic";
const SERVICE = "claude_code";

const buildService = (anthropic) => {
  // eslint-disable-next-line no-unused-vars
  const { _id, web_search_tool, validation_config, in_built_tools, ...rest } = anthropic;
  return {
    ...rest,
    service_name: SERVICE,
    client: "claude_code_cli",
    // Nothing to call from Node: the gateway checks a Claude login by making one tiny call on it.
    validation_config: { method: "GATEWAY", path: "claude_code/verify", headers: {} },
    in_built_tools: (in_built_tools || []).filter((tool) => !/web search/i.test(tool?.name || "") || /gtwy/i.test(tool?.name || "")),
    status: 1
  };
};

const buildModel = (model) => {
  // eslint-disable-next-line no-unused-vars
  const { _id, __v, created_at, updated_at, ...rest } = model;
  const validationConfig = { ...(rest.validationConfig || {}) };
  validationConfig.mcp_type = "client";
  validationConfig.inbuilt_tools = { ...(validationConfig.inbuilt_tools || {}), web_search: false };
  if (validationConfig.specification) {
    // eslint-disable-next-line no-unused-vars
    const { batch_input_cost, batch_output_cost, batch_cached_cost, ...specification } = validationConfig.specification;
    validationConfig.specification = specification;
  }
  return { ...rest, service: SERVICE, validationConfig };
};

export const up = async (db) => {
  const now = new Date();

  const anthropic = await db.collection("services").findOne({ service_name: SOURCE });
  if (!anthropic) throw new Error(`[claude_code] no "${SOURCE}" services document to copy from`);
  const serviceResult = await db.collection("services").updateOne({ service_name: SERVICE }, { $set: buildService(anthropic) }, { upsert: true });
  console.log(`[claude_code] service ${serviceResult.upsertedCount ? "inserted" : serviceResult.modifiedCount ? "updated" : "unchanged"}.`);

  const models = await db.collection("modelconfigurations").find({ service: SOURCE, status: 1, "validationConfig.type": "chat" }).toArray();
  if (!models.length) throw new Error(`[claude_code] no active "${SOURCE}" chat models to copy`);
  const modelOps = models.map(buildModel).map((model) => ({
    updateOne: {
      filter: { service: SERVICE, model_name: model.model_name },
      update: { $set: { ...model, updated_at: now }, $setOnInsert: { created_at: now } },
      upsert: true
    }
  }));
  const modelResult = await db.collection("modelconfigurations").bulkWrite(modelOps, { ordered: false });
  console.log(`[claude_code] models: ${modelResult.upsertedCount} inserted, ${modelResult.modifiedCount} updated, ${models.length} total.`);
};

/**
 * Removes the service and its models. Saved Claude logins (apikeycredentials rows with service
 * "claude_code") are left in place.
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  await db.collection("modelconfigurations").deleteMany({ service: SERVICE });
  await db.collection("services").deleteMany({ service_name: SERVICE });
};
