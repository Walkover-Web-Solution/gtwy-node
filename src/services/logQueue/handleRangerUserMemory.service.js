import { callAiMiddleware } from "../utils/aiCall.utils.js";
import { bridge_ids } from "../../configs/constant.js";
import { deleteInCache } from "../../cache_service/index.js";
import logger from "../../logger.js";

function normalizeContent(value) {
  if (value && typeof value === "object") return JSON.stringify(value);
  return value ?? "";
}

const TRIGGER_MESSAGE = "Process the conversation history above and update memory per your instructions."; // imperative, not descriptive — nothing here should read as a fact to store

function buildConversation(pendingTurns) {
  if (Array.isArray(pendingTurns) && pendingTurns.length > 0) {
    return pendingTurns.filter((msg) => msg && msg.role).map((msg) => ({ role: msg.role, content: normalizeContent(msg.content) }));
  }
  return [];
}

async function handleRangerUserMemory({
  bridge_id,
  user_id,
  pending_turns,
  ranger_memory,
  ranger_memory_context,
  user_memory,
  user_memory_context
}) {
  try {
    if (!bridge_ids.ranger_user_memory) {
      logger.warn("handleRangerUserMemory: bridge_ids.ranger_user_memory is not configured, skipping call");
      return;
    }

    if (!ranger_memory && !user_memory) {
      logger.info(`handleRangerUserMemory: neither scope enabled for bridge ${bridge_id}, skipping call`);
      return;
    }

    const conversation = buildConversation(pending_turns);

    const variables = {
      ranger_memory_context: ranger_memory ? ranger_memory_context || "" : "",
      user_memory_context: user_memory ? user_memory_context || "" : "",
      ranger_memory_enabled: !!ranger_memory,
      user_memory_enabled: !!user_memory,
      bridge_id,
      user_id
    };

    const configuration = {
      conversation
    };

    const rangerContext = ranger_memory && ranger_memory_context ? `Ranger memory storage instructions: ${ranger_memory_context}` : "";
    const userContext = user_memory && user_memory_context ? `User memory storage instructions: ${user_memory_context}` : "";
    const message = [TRIGGER_MESSAGE, rangerContext, userContext].filter(Boolean).join("\n\n");

    const response = await callAiMiddleware(message, bridge_ids.ranger_user_memory, variables, configuration, "text");

    if (response === "True") {
      try {
        const keysToInvalidate = [];
        if (ranger_memory && bridge_id) keysToInvalidate.push(`ranger_${bridge_id}`);
        if (user_memory && user_id) keysToInvalidate.push(`user_${user_id}`);
        if (keysToInvalidate.length > 0) {
          await deleteInCache(keysToInvalidate);
        }
        logger.info(`handleRangerUserMemory: memory updated for bridge ${bridge_id}, invalidated cache keys ${keysToInvalidate.join(", ")}`);
      } catch (cacheErr) {
        logger.error(`handleRangerUserMemory: failed to invalidate cache for bridge ${bridge_id}: ${cacheErr.message}`);
      }
    } else if (response === "False") {
      logger.info(`handleRangerUserMemory: no update needed for bridge ${bridge_id}`);
    } else {
      logger.warn(`handleRangerUserMemory: unexpected response for bridge ${bridge_id}: ${response}`);
    }

    return response;
  } catch (err) {
    logger.error(`Error calling function handleRangerUserMemory: ${err.message}`);
  }
}

export { handleRangerUserMemory };
