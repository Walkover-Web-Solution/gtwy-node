import { storeInCache } from "../../cache_service/index.js";
import { callAiMiddleware } from "../utils/aiCall.utils.js";
import { bridge_ids, redis_keys } from "../../configs/constant.js";
import { GPT_MEMORY_PROMPT } from "../../configs/prompts.config.js";
import prebuiltPromptDbService from "../../db_services/prebuiltPrompt.service.js";
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
  
  const { id } = params;
  
  if (!id || typeof id !== "string") {
    return { isValid: false, error: "Missing or invalid id (thread_id)" };
  }
  
  return { isValid: true };
}

/**
 * Handle GPT memory storage based on conversation context
 * @param {Object} data - Memory handling data
 * @param {string} data.id - Thread ID
 * @param {string} data.user - User message
 * @param {Object} data.assistant - Assistant response object
 * @param {string} data.purpose - Memory purpose/context
 * @param {string} data.gpt_memory_context - Existing memory context
 * @param {string} data.org_id - Organization ID
 */
async function handleGptMemory(data) {
  const validation = validateParams(data);
  if (!validation.isValid) {
    logger.warn(`handleGptMemory: ${validation.error}`);
    return;
  }

  const { id, user, assistant, purpose, gpt_memory_context, org_id } = data;

  try {
    const variables = { 
      threadID: id, 
      memory: purpose || "", 
      gpt_memory_context: gpt_memory_context || "" 
    };
    
    const content = assistant?.data?.content || "";

    const configuration = {
      conversation: [
        { role: "user", content: user || "" },
        { role: "assistant", content }
      ]
    };

    // Check for custom prompt override from prebuilt prompts
    if (org_id) {
      const updated_prompt = await prebuiltPromptDbService.getSpecificPrebuiltPrompt(org_id, "gpt_memory");
      if (updated_prompt?.gpt_memory) {
        configuration.prompt = updated_prompt.gpt_memory;
      }
    }

    // Use centralized prompt constant instead of hardcoded string
    const response = await callAiMiddleware(
      GPT_MEMORY_PROMPT,
      bridge_ids.gpt_memory,
      variables,
      configuration,
      "text"
    );

    // Store memory in cache if valid response
    if (typeof response === "string" && response !== "False" && response.trim()) {
      const cache_key = `${redis_keys.gpt_memory_}${id}`;
      await storeInCache(cache_key, response);
      logger.debug(`Stored GPT memory for thread_id=${id}`);
    }

    return response;
  } catch (err) {
    logger.error(`Error in handleGptMemory: ${err.message}`);
  }
}

export { handleGptMemory };
