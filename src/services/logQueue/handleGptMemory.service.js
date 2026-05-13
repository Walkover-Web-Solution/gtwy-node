import { callAiMiddleware } from "../utils/aiCall.utils.js";
import { bridge_ids } from "../../configs/constant.js";
import prebuiltPromptDbService from "../../db_services/prebuiltPrompt.service.js";
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

async function handleGptMemory({ id, user, assistant, purpose, gpt_memory_context, org_id, pending_turns }) {
  try {
    const memoryVar = purpose && typeof purpose === "object" ? JSON.stringify(purpose) : purpose;
    const variables = { threadID: id, memory: memoryVar, gpt_memory_context };

    const configuration = {
      conversation: buildConversation(pending_turns, user, assistant)
    };

    const updated_prompt = await prebuiltPromptDbService.getSpecificPrebuiltPrompt(org_id, "gpt_memory");
    if (updated_prompt?.gpt_memory) {
      configuration.prompt = updated_prompt.gpt_memory;
    }

    const message =
      "use the function to store the memory if the user message and history is related to the context or is important to store else don't call the function and ignore it. is purpose is not there than think its the begining of the conversation. Only return the exact memory as output no an extra text jusy memory if present or Just return False";

    const response = await callAiMiddleware(message, bridge_ids.gpt_memory, variables, configuration, "text");

    if (response === "True") {
      logger.info(`handleGptMemory: memory updated via tool for ${id}`);
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
