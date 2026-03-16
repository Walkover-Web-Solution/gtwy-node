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
import { updateBatchHistory } from "../services/logQueue/updateBatchHistory.service.js";
import { saveBatchMetrics } from "../services/logQueue/saveBatchMetrics.service.js";

/**
 * Process messages from the log queue
 * Handles various message types including regular logs, agent memory, and batch operations
 * @param {Object} messages - Parsed message object from queue
 */
async function processLogQueueMessage(messages) {
  // Validate messages object
  if (!messages || typeof messages !== "object") {
    logger.warn("processLogQueueMessage: Invalid message format");
    return;
  }

  // Handle save_sub_thread_id_and_name
  if (messages["save_sub_thread_id_and_name"]) {
    await saveSubThreadIdAndName(messages["save_sub_thread_id_and_name"]);
  }

  // Skip further processing for image type messages
  if (messages.type === "image") {
    return;
  }

  // Handle agent memory (save_to_hippocampus / save_agent_memory)
  const agent_memory_data = messages.save_agent_memory || messages.save_to_hippocampus || {};
  if (agent_memory_data.chatbot_auto_answers) {
    await saveToAgentMemory({
      user_question: agent_memory_data.user_message || "",
      assistant_answer: agent_memory_data.assistant_message || "",
      agent_id: agent_memory_data.bridge_id || "",
      bridge_name: agent_memory_data.bridge_name || "",
      system_prompt: agent_memory_data.system_prompt || ""
    });
  }

  // Handle sendApiHitEvent (only if not alert_flag)
  if (messages["validateResponse"] && !messages["validateResponse"]?.alert_flag) {
    await sendApiHitEvent({
      message_id: messages["validateResponse"]?.message_id,
      org_id: messages["validateResponse"]?.org_id
    });
  }

  // Handle validateResponse
  if (messages["validateResponse"]) {
    await validateResponse(messages["validateResponse"]);
  }

  // Handle totalTokenCalculation
  if (messages["total_token_calculation"]) {
    await totalTokenCalculation(messages["total_token_calculation"]);
  }

  // Handle handleGptMemory (check condition first)
  if (messages["check_handle_gpt_memory"]?.gpt_memory && messages["handle_gpt_memory"]) {
    await handleGptMemory(messages["handle_gpt_memory"]);
  }

  // Handle chatbotSuggestions (check condition first)
  if (messages["check_chatbot_suggestions"]?.bridgeType && messages["chatbot_suggestions"]) {
    await chatbotSuggestions(messages["chatbot_suggestions"]);
  }

  // Handle saveFilesToRedis
  if (messages["save_files_to_redis"]) {
    await saveFilesToRedis(messages["save_files_to_redis"]);
  }

  // Handle broadcastResponseWebhook
  if (messages["broadcast_response_webhook"]) {
    await broadcastResponseWebhook(messages["broadcast_response_webhook"]);
  }

  // Handle batch history updates (from Python batch processing)
  if (messages["update_batch_history"]) {
    await updateBatchHistory(messages["update_batch_history"]);
  }

  // Handle batch metrics (from Python batch processing)
  if (messages["save_batch_metrics"]) {
    await saveBatchMetrics(messages["save_batch_metrics"]);
  }
}

/**
 * Log queue processor function for Consumer class
 * Parses JSON message and processes it
 * @param {Object} message - Raw RabbitMQ message
 * @param {Object} channel - RabbitMQ channel
 */
async function logQueueProcessor(message, channel) {
  let message_data;
  try {
    message_data = JSON.parse(message.content.toString());
    await processLogQueueMessage(message_data);
    channel.ack(message);
  } catch (err) {
    logger.error(`Error processing log queue message: ${err.message}`);
    // Reject message without requeue to avoid infinite loops
    channel.nack(message, false, false);
  }
}

/**
 * Log queue consumer configuration
 * batchSize increased from 1 to 10 for better throughput
 */
const logQueueConsumerConfig = {
  queueName: process.env.LOG_QUEUE_NAME || `AI-MIDDLEWARE-DATA-QUEUE-${process.env.ENVIROMENT || "development"}`,
  process: logQueueProcessor,
  batchSize: 10 // Increased from 1 for better throughput
};

export { logQueueProcessor, logQueueConsumerConfig, processLogQueueMessage };
