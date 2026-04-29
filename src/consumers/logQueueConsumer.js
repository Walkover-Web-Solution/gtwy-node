import logger from "../logger.js";
import { saveSubThreadIdAndName } from "../services/logQueue/saveSubThreadIdAndName.service.js";
import { validateResponse } from "../services/logQueue/validateResponse.service.js";
import { totalTokenCalculation } from "../services/logQueue/totalTokenCalculation.service.js";
import { chatbotSuggestions } from "../services/logQueue/chatbotSuggestions.service.js";
import { handleGptMemory } from "../services/logQueue/handleGptMemory.service.js";
import { saveToAgentMemory } from "../services/logQueue/saveToAgentMemory.service.js";
import { saveFilesToRedis } from "../services/logQueue/saveFilesToRedis.service.js";
import { sendApiHitEvent } from "../services/logQueue/sendApiHitEvent.service.js";
import { broadcastResponseWebhook } from "../services/logQueue/broadcastResponseWebhook.service.js";
import {
  saveConversationHistory,
  saveOrchestratorHistory,
  saveBatchHistory,
  updateBatchHistory,
  updateConversationHistory
} from "../services/logQueue/saveHistory.service.js";

async function processLogQueueMessage(messages) {
  if (messages["save_sub_thread_id_and_name"]) {
    await saveSubThreadIdAndName(messages["save_sub_thread_id_and_name"]);
  }

  if (messages["save_history"]) {
    await saveConversationHistory(messages["save_history"]);
  }

  if (messages["update_history"]) {
    await updateConversationHistory(messages["update_history"]);
  }

  if (messages["save_orchestrator_history"]) {
    await saveOrchestratorHistory(messages["save_orchestrator_history"]);
  }

  if (messages["save_batch_history"]) {
    await saveBatchHistory(messages["save_batch_history"]);
  }

  if (messages["update_batch_history"]) {
    await updateBatchHistory(messages["update_batch_history"]);
  }

  if (messages.type === "image") {
    return;
  }

  const agent_memory_data = messages.save_agent_memory || {};
  if (agent_memory_data.chatbot_auto_answers) {
    await saveToAgentMemory({
      user_question: agent_memory_data.user_message || "",
      assistant_answer: agent_memory_data.assistant_message || "",
      agent_id: agent_memory_data.bridge_id || "",
      bridge_name: agent_memory_data.bridge_name || "",
      system_prompt: agent_memory_data.system_prompt || "",
      is_cache_hit: agent_memory_data.is_cache_hit || false,
      cached_resource_id: agent_memory_data.resource_id || null
    });
  }

  if (messages["validateResponse"]) {
    if (!messages["validateResponse"]?.alert_flag) {
      await sendApiHitEvent({
        message_id: messages["validateResponse"]?.message_id,
        org_id: messages["validateResponse"]?.org_id
      });
    }
    await validateResponse(messages["validateResponse"]);
  }

  if (messages["total_token_calculation"]) {
    await totalTokenCalculation(messages["total_token_calculation"]);
  }
  if (messages["check_handle_gpt_memory"]?.gpt_memory) {
    await handleGptMemory(messages["handle_gpt_memory"]);
  }

  if (messages["check_chatbot_suggestions"]?.bridgeType) {
    await chatbotSuggestions(messages["chatbot_suggestions"]);
  }

  if (messages["save_files_to_redis"]) {
    await saveFilesToRedis(messages["save_files_to_redis"]);
  }
  if (messages.broadcast_response_webhook) {
    await broadcastResponseWebhook(messages["broadcast_response_webhook"]);
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
    channel.nack(message, false, false);
  }
}

export { logQueueProcessor };
