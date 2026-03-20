import { storeInCache } from "../../cache_service/index.js";
import { callAiMiddleware } from "../utils/aiCall.utils.js";
import { bridge_ids, redis_keys } from "../../configs/constant.js";
import prebuiltPromptDbService from "../../db_services/prebuiltPrompt.service.js";
import logger from "../../logger.js";

async function handleGptMemory({ id, user, assistant, purpose, gpt_memory_context, org_id }) {
  try {
    const variables = { threadID: id, memory: purpose, gpt_memory_context };
    const content = assistant?.data?.content || "";

    const configuration = {
      conversation: [
        { role: "user", content: user },
        { role: "assistant", content }
      ]
    };

    const updated_prompt = await prebuiltPromptDbService.getSpecificPrebuiltPrompt(org_id, "gpt_memory");
    if (updated_prompt?.gpt_memory) {
      configuration.prompt = updated_prompt.gpt_memory;
    }

    const message =
      "use the function to store the memory if the user message and history is related to the context or is important to store else don't call the function and ignore it. is purpose is not there than think its the begining of the conversation. Only return the exact memory as output no an extra text jusy memory if present or Just return False";

    const response = await callAiMiddleware(message, bridge_ids.gpt_memory, variables, configuration, "text");

    if (typeof response === "string" && response !== "False") {
      const cache_key = `${redis_keys.gpt_memory_}${id}`;
      await storeInCache(cache_key, response);
    }

    return response;
  } catch (err) {
    logger.error(`Error calling function handleGptMemory: ${err.message}`);
  }
}

export { handleGptMemory };
