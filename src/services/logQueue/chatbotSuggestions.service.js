import { callAiMiddleware } from "../utils/aiCall.utils.js";
import { bridge_ids } from "../../configs/constant.js";
import logger from "../../logger.js";

/**
 * Validates the input parameters
 * @param {Object} params - The parameters to validate
 * @returns {Object} - { isValid: boolean, error?: string }
 */
function validateParams(params) {
  if (!params || typeof params !== "object") {
    return { isValid: false, error: "Invalid params: expected an object" };
  }
  
  const { thread_id, sub_thread_id, org_id } = params;
  
  if (!thread_id || typeof thread_id !== "string") {
    return { isValid: false, error: "Missing or invalid thread_id" };
  }
  if (!sub_thread_id || typeof sub_thread_id !== "string") {
    return { isValid: false, error: "Missing or invalid sub_thread_id" };
  }
  if (!org_id || typeof org_id !== "string") {
    return { isValid: false, error: "Missing or invalid org_id" };
  }
  
  return { isValid: true };
}

/**
 * Generate chatbot suggestions based on conversation context
 * @param {Object} data - Suggestion generation data
 * @param {Object} data.response_format - Response format configuration
 * @param {Object} data.assistant - Assistant response data
 * @param {string} data.user - User message
 * @param {string} data.bridge_summary - Bridge summary
 * @param {string} data.thread_id - Thread ID
 * @param {string} data.sub_thread_id - Sub-thread ID
 * @param {Object} data.configuration - Configuration object
 * @param {string} data.org_id - Organization ID
 */
async function chatbotSuggestions(data) {
  const validation = validateParams(data);
  if (!validation.isValid) {
    logger.warn(`chatbotSuggestions: ${validation.error}`);
    return;
  }

  const { response_format, assistant, user, bridge_summary, thread_id, sub_thread_id, configuration, org_id } = data;

  try {
    // Skip if no response format or not configured for suggestions
    if (!response_format?.type || response_format.type !== "chatbot") {
      return;
    }

    const assistantContent = assistant?.data?.content || "";
    if (!assistantContent || !user) {
      return;
    }

    // Build variables for suggestion generation
    const variables = {
      user_message: user,
      assistant_response: assistantContent,
      bridge_summary: bridge_summary || "",
      thread_id,
      sub_thread_id
    };

    // Call AI to generate suggestions
    const suggestions = await callAiMiddleware(
      "Generate follow-up suggestions based on the conversation",
      bridge_ids.chatbot_suggestions,
      variables,
      configuration,
      "text"
    );

    if (suggestions) {
      logger.debug(`Generated suggestions for thread_id=${thread_id}`);
    }

    return suggestions;
  } catch (err) {
    logger.error(`Error in chatbotSuggestions: ${err.message}`);
  }
}

export { chatbotSuggestions };
