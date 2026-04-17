import { Op, literal } from "sequelize";
import models from "../../../models/index.js";
import logger from "../../logger.js";

/**
 * Save a list of regular conversation log entries to PostgreSQL.
 * Each entry contains { conversation_log_data, metrics_data, total_tokens, bridge_id }.
 *
 * @param {Array} historyEntries - Array of history payload objects built by Python
 */
async function saveConversationHistory(historyEntries) {
  const data = historyEntries?.[0]?.conversation_log_data;
  if (!data) return;

  try {
    await models.pg.conversation_logs.create({
      llm_message: data.llm_message ?? null,
      user: data.user ?? null,
      chatbot_message: data.chatbot_message ?? null,
      updated_llm_message: data.updated_llm_message ?? null,
      prompt: data.prompt ?? null,
      error: data.error ?? null,
      user_feedback: data.user_feedback ?? 0,
      tools_call_data: data.tools_call_data ?? [],
      message_id: data.message_id ?? null,
      sub_thread_id: data.sub_thread_id ?? null,
      thread_id: data.thread_id ?? null,
      version_id: data.version_id ?? null,
      bridge_id: data.bridge_id ?? null,
      user_urls: data.user_urls ?? [],
      llm_urls: data.llm_urls ?? [],
      AiConfig: data.AiConfig ?? null,
      fallback_model: data.fallback_model ?? null,
      org_id: data.org_id ?? null,
      service: data.service ?? null,
      model: data.model ?? null,
      status: data.status ?? false,
      tokens: data.tokens ?? null,
      variables: data.variables ?? null,
      latency: data.latency ?? null,
      firstAttemptError: data.firstAttemptError ?? null,
      finish_reason: data.finish_reason ?? null,
      parent_id: data.parent_id ?? null,
      child_id: data.child_id ?? null,
      plans: data.plans ?? null
    });
  } catch (err) {
    logger.error(`Error saving conversation log (message_id=${data.message_id}): ${err.message}`);
  }
}

/**
 * Save an orchestrator conversation log entry to PostgreSQL.
 * Fields contain dicts keyed by bridge_id (stored as JSONB).
 *
 * @param {Object} orchestratorLogData - Orchestrator log data built by Python
 */
async function saveOrchestratorHistory(orchestratorLogData) {
  if (!orchestratorLogData) return;

  try {
    await models.pg.orchestrator_conversation_logs.create({
      llm_message: orchestratorLogData.llm_message ?? null,
      reasoning: orchestratorLogData.reasoning ?? null,
      user: orchestratorLogData.user ?? null,
      chatbot_message: orchestratorLogData.chatbot_message ?? null,
      updated_llm_message: orchestratorLogData.updated_llm_message ?? null,
      prompt: orchestratorLogData.prompt ?? null,
      error: orchestratorLogData.error ?? null,
      tools_call_data: orchestratorLogData.tools_call_data ?? {},
      message_id: orchestratorLogData.message_id ?? null,
      sub_thread_id: orchestratorLogData.sub_thread_id ?? null,
      thread_id: orchestratorLogData.thread_id ?? null,
      version_id: orchestratorLogData.version_id ?? null,
      bridge_id: orchestratorLogData.bridge_id ?? null,
      image_urls: orchestratorLogData.image_urls ?? orchestratorLogData.user_urls ?? [],
      urls: orchestratorLogData.urls ?? orchestratorLogData.llm_urls ?? [],
      AiConfig: orchestratorLogData.AiConfig ?? null,
      fallback_model: orchestratorLogData.fallback_model ?? null,
      org_id: orchestratorLogData.org_id ?? null,
      service: orchestratorLogData.service ?? null,
      model: orchestratorLogData.model ?? null,
      status: orchestratorLogData.status ?? {},
      tokens: orchestratorLogData.tokens ?? null,
      variables: orchestratorLogData.variables ?? null,
      latency: orchestratorLogData.latency ?? null,
      firstAttemptError: orchestratorLogData.firstAttemptError ?? null,
      finish_reason: orchestratorLogData.finish_reason ?? null,
      agents_path: orchestratorLogData.agents_path ?? [],
      plans: orchestratorLogData.plans ?? null
    });
  } catch (err) {
    logger.error(`Error saving orchestrator history (thread_id=${orchestratorLogData.thread_id}): ${err.message}`);
  }
}

/**
 * Bulk-create initial batch conversation log entries (status = queued).
 *
 * @param {Array} entries - Array of conversation_log_data objects
 */
async function saveBatchHistory(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;

  try {
    const rows = entries.map((data) => ({
      llm_message: data.llm_message ?? null,
      reasoning: data.reasoning ?? null,
      user: data.user ?? null,
      chatbot_message: data.chatbot_message ?? null,
      updated_llm_message: null,
      prompt: data.prompt ?? null,
      error: null,
      user_feedback: 0,
      tools_call_data: data.tools_call_data ?? [],
      message_id: data.message_id ?? null,
      sub_thread_id: data.sub_thread_id ?? null,
      thread_id: data.thread_id ?? null,
      version_id: data.version_id ?? null,
      bridge_id: data.bridge_id ?? null,
      user_urls: data.user_urls ?? [],
      llm_urls: data.llm_urls ?? [],
      AiConfig: data.AiConfig ?? null,
      fallback_model: data.fallback_model ?? null,
      org_id: data.org_id ?? null,
      service: data.service ?? null,
      model: data.model ?? null,
      status: data.status ?? false,
      tokens: data.tokens ?? null,
      variables: data.variables ?? null,
      latency: null,
      batch_data: data.batch_data ?? null,
      plans: data.plans ?? null
    }));

    await models.pg.conversation_logs.bulkCreate(rows);
  } catch (err) {
    logger.error(`Error bulk-creating batch conversation logs: ${err.message}`);
  }
}

/**
 * Update batch conversation logs with results from the provider.
 * Each item in updates contains { batch_id, message_id, update_data }.
 *
 * @param {Array} updates - Array of update descriptor objects
 */
async function updateBatchHistory(updates) {
  if (!Array.isArray(updates) || updates.length === 0) return;

  for (const item of updates) {
    const { batch_id, message_id, update_data } = item;
    if (!batch_id || !message_id || !update_data) continue;

    try {
      await models.pg.conversation_logs.update(update_data, {
        where: {
          message_id,
          [Op.and]: literal(`batch_data->>'batch_id' = '${batch_id.replace(/'/g, "''")}'`)
        }
      });
    } catch (err) {
      logger.error(`Error updating batch conversation log (batch_id=${batch_id}, message_id=${message_id}): ${err.message}`);
    }
  }
}

/**
 * Update an existing conversation log entry by message_id.
 * Used when Python sends update_history with partial data to update a previously created log.
 *
 * @param {Object} updateData - Update payload with message_id and fields to update
 */
const UPDATABLE_COLS = new Set([
  "llm_message",
  "reasoning",
  "chatbot_message",
  "updated_llm_message",
  "error",
  "tools_call_data",
  "user_urls",
  "llm_urls",
  "AiConfig",
  "fallback_model",
  "service",
  "model",
  "status",
  "tokens",
  "variables",
  "latency",
  "firstAttemptError",
  "finish_reason",
  "plans",
  "prompt"
]);

async function updateConversationHistory(updateData) {
  if (!updateData || !updateData.message_id) return;

  const updateFields = {};
  for (const [key, value] of Object.entries(updateData)) {
    if (UPDATABLE_COLS.has(key) && value !== undefined) {
      updateFields[key] = value;
    }
  }

  if (Object.keys(updateFields).length === 0) return;

  try {
    await models.pg.conversation_logs.update(updateFields, {
      where: { message_id: updateData.message_id }
    });
  } catch (err) {
    logger.error(`Error updating conversation log (message_id=${updateData.message_id}): ${err.message}`);
  }
}

export { saveConversationHistory, saveOrchestratorHistory, saveBatchHistory, updateBatchHistory, updateConversationHistory };
