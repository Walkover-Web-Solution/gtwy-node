import logger from "../logger.js";
import { unknown_error_handler_alert } from "../services/utils/utility.service.js";
import { saveSubThreadIdAndName } from "../services/logQueue/saveSubThreadIdAndName.service.js";
import { validateResponse } from "../services/logQueue/validateResponse.service.js";
import { chatbotSuggestions } from "../services/logQueue/chatbotSuggestions.service.js";
import { handleGptMemory } from "../services/logQueue/handleGptMemory.service.js";
import { saveToAgentMemory } from "../services/logQueue/saveToAgentMemory.service.js";
import { saveFilesToRedis } from "../services/logQueue/saveFilesToRedis.service.js";
import { sendApiHitEvent } from "../services/logQueue/sendApiHitEvent.service.js";
import { processBillingEvents } from "../services/logQueue/billingDebit.service.js";
import { broadcastResponseWebhook } from "../services/logQueue/broadcastResponseWebhook.service.js";
import {
  saveConversationHistory,
  saveOrchestratorHistory,
  saveBatchHistory,
  updateBatchHistory,
  updateConversationHistory
} from "../services/logQueue/saveHistory.service.js";

async function saveHistoryBlock(messages) {
  // Insert first, then resolve + persist display_name via UPDATE (only when AI generates it)
  await saveConversationHistory(messages["save_history"]);
  const conv = messages["save_history"]?.[0];
  if (conv?.sub_thread_id) {
    await saveSubThreadIdAndName({
      org_id: conv.org_id,
      thread_id: conv.thread_id,
      sub_thread_id: conv.sub_thread_id,
      bridge_id: conv.bridge_id,
      user: conv.user,
      thread_flag: conv.thread_flag,
      response_format: conv.response_format
    });
  }
}

async function saveOrchestratorHistoryBlock(messages) {
  await saveOrchestratorHistory(messages["save_orchestrator_history"]);
  const orchestratorSubThreadData = messages["save_orchestrator_history"]?.sub_thread_data;
  if (orchestratorSubThreadData) {
    await saveSubThreadIdAndName(orchestratorSubThreadData);
  }
}

async function saveBatchHistoryBlock(messages) {
  await saveBatchHistory(messages["save_batch_history"]);
  const batchEntry = messages["save_batch_history"]?.[0];
  if (batchEntry?.sub_thread_id) {
    await saveSubThreadIdAndName({
      org_id: batchEntry.org_id,
      thread_id: batchEntry.thread_id,
      sub_thread_id: batchEntry.sub_thread_id,
      bridge_id: batchEntry.bridge_id,
      user: batchEntry.user,
      thread_flag: batchEntry.thread_flag,
      response_format: batchEntry.response_format
    });
  }
}

async function validateResponseBlock(messages) {
  // sendApiHitEvent (per-hit usage event into a subscription plan) and the
  // wallet debit in `messages["billing"]` are two parallel Lago billing
  // mechanisms that must never both be live for the same call (doc §4 "repo
  // reality check" — the exact double-billing this design exists to prevent).
  // `messages["billing"]` is only attached once BILLING_ENABLED=true on the
  // Python side, so its presence is the per-message signal that wallet debits
  // have taken over for this call — fall back to sendApiHitEvent only when it's
  // absent. This self-migrates the moment BILLING_ENABLED flips, with no
  // separate Node-side config to keep in sync.
  if (!messages["validateResponse"]?.alert_flag && !messages["billing"]) {
    await sendApiHitEvent({
      message_id: messages["validateResponse"]?.message_id,
      org_id: messages["validateResponse"]?.org_id
    });
  }
  await validateResponse(messages["validateResponse"]);
}

async function processLogQueueMessage(messages) {
  // Run all independent history writes in parallel
  const parallelTasks = [];

  if (messages["save_history"]) parallelTasks.push(saveHistoryBlock(messages));
  if (messages["update_history"]) parallelTasks.push(updateConversationHistory(messages["update_history"]));
  if (messages["save_orchestrator_history"]) parallelTasks.push(saveOrchestratorHistoryBlock(messages));
  if (messages["save_batch_history"]) parallelTasks.push(saveBatchHistoryBlock(messages));
  if (messages["update_batch_history"]) parallelTasks.push(updateBatchHistory(messages["update_batch_history"]));

  await Promise.all(parallelTasks);

  if (messages.type === "image") {
    return;
  }

  // Run remaining independent tasks in parallel
  const postHistoryTasks = [];

  const agent_memory_data = messages.save_agent_memory || {};
  if (agent_memory_data.cache_on) {
    postHistoryTasks.push(
      saveToAgentMemory({
        user_question: agent_memory_data.user_message || "",
        assistant_answer: agent_memory_data.assistant_message || "",
        agent_id: agent_memory_data.bridge_id || "",
        bridge_name: agent_memory_data.bridge_name || "",
        system_prompt: agent_memory_data.system_prompt || "",
        is_cache_hit: agent_memory_data.is_cache_hit || false,
        cached_resource_id: agent_memory_data.resource_id || null
      })
    );
  }

  if (messages["validateResponse"]) postHistoryTasks.push(validateResponseBlock(messages));
  if (messages["save_files_to_redis"]) postHistoryTasks.push(saveFilesToRedis(messages["save_files_to_redis"]));
  if (messages["billing"]) postHistoryTasks.push(processBillingEvents(messages["billing"]));

  await Promise.all(postHistoryTasks);

  // Fire-and-forget: AI calls and outbound webhooks — don't block ack
  if (messages["check_handle_gpt_memory"]?.gpt_memory) {
    handleGptMemory(messages["handle_gpt_memory"]).catch((err) => {
      logger.error(`Error in handleGptMemory: ${err.message}`);
      unknown_error_handler_alert("handleGptMemory", null, err.message);
    });
  }

  if (messages["check_chatbot_suggestions"]?.bridgeType) {
    chatbotSuggestions(messages["chatbot_suggestions"]).catch((err) => {
      logger.error(`Error in chatbotSuggestions: ${err.message}`);
      unknown_error_handler_alert("chatbotSuggestions", null, err.message);
    });
  }

  if (messages.broadcast_response_webhook) {
    broadcastResponseWebhook(messages["broadcast_response_webhook"]).catch((err) => {
      logger.error(`Error in broadcastResponseWebhook: ${err.message}`);
      unknown_error_handler_alert("broadcastResponseWebhook", null, err.message);
    });
  }
}

async function logQueueProcessor(message, channel) {
  let message_data;
  try {
    message_data = JSON.parse(message.content.toString());
    await processLogQueueMessage(message_data);
    channel.ack(message);
  } catch (err) {
    logger.error(`Error processing log queue message: ${err.message}`);
    unknown_error_handler_alert("logQueueProcessor", null, err.message);
    channel.nack(message, false, false);
  }
}

export { logQueueProcessor };
