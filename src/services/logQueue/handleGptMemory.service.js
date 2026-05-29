import { callAiMiddleware } from "../utils/aiCall.utils.js";
import { bridge_ids } from "../../configs/constant.js";
import prebuiltPromptDbService from "../../db_services/prebuiltPrompt.service.js";
import { refreshGptMemoryCache } from "../utils/gptMemory.service.js";
import logger from "../../logger.js";

function normalizeContent(value) {
  if (value && typeof value === "object") return JSON.stringify(value);
  return value ?? "";
}

function buildConversation(pendingTurns, user, assistant) {
  if (Array.isArray(pendingTurns) && pendingTurns.length > 0) {
    return pendingTurns
      .filter((msg) => msg && msg.role && !["tool", "tools_call"].includes(msg.role))
      .map((msg) => ({ role: msg.role, content: normalizeContent(msg.content) }));
  }
  const content = assistant?.data?.content ?? assistant ?? "";
  return [
    { role: "user", content: normalizeContent(user) },
    { role: "assistant", content: normalizeContent(content) }
  ];
}

async function handleGptMemory({
  id,
  user,
  assistant,
  purpose,
  gpt_memory_context,
  org_id,
  pending_turns,
  bridge_summary,
  thread_id,
  sub_thread_id,
  bridge_id,
  version_id
}) {
  try {
    const memoryVar = purpose && typeof purpose === "object" ? JSON.stringify(purpose) : purpose;
    const variables = {
      threadID: id,
      memory: memoryVar,
      gpt_memory_context,
      bridge_summary: bridge_summary || ""
    };

    const configuration = {
      conversation: buildConversation(pending_turns, user, assistant)
    };

    const updated_prompt = await prebuiltPromptDbService.getSpecificPrebuiltPrompt(org_id, "gpt_memory");
    if (updated_prompt?.gpt_memory) {
      configuration.prompt = updated_prompt.gpt_memory;
    }

    const bridgeContext = bridge_summary ? `Context about the main agent you are storing memory for:\n${bridge_summary}\n\n` : "";
    const memoryContext = gpt_memory_context ? `\n\nMemory storage instructions: ${gpt_memory_context}` : "";
    const message = `${bridgeContext}\n\n${memoryContext}`;

    const response = await callAiMiddleware(message, bridge_ids.gpt_memory, variables, configuration, "text");

    if (response === "True") {
      try {
        const { memoryId } = await refreshGptMemoryCache({
          bridge_id,
          thread_id,
          sub_thread_id,
          version_id
        });
        logger.info(`handleGptMemory: memory updated via tool for ${id}, refreshed cache ${memoryId}`);
      } catch (cacheErr) {
        logger.error(`handleGptMemory: failed to refresh cache for ${id}: ${cacheErr.message}`);
      }
    } else if (response === "False") {
      logger.info(`handleGptMemory: no update needed for ${id}`);
    } else {
      logger.warn(`handleGptMemory: unexpected response for ${id}: ${response}`);
    }

    return response;
  } catch (err) {
    logger.error(`Error calling function handleGptMemory: ${err.message}`);
  }
}

export { handleGptMemory };
