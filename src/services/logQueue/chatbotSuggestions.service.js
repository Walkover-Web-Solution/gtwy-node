import { v4 as uuidv4 } from "uuid";
import { callAiMiddlewareWithUsage } from "../utils/aiCall.utils.js";
import { sendResponse } from "../utils/utility.service.js";
import { bridge_ids } from "../../configs/constant.js";
import prebuiltPromptDbService from "../../db_services/prebuiltPrompt.service.js";
import logger from "../../logger.js";
import { debitBackgroundJob } from "./backgroundJobBilling.service.js";

async function chatbotSuggestions({
  response_format,
  assistant,
  user,
  bridge_summary,
  thread_id,
  sub_thread_id,
  configuration,
  org_id,
  background_billing
}) {
  try {
    const prompt_summary = bridge_summary;
    const prompt = configuration?.prompt;

    const conversation = [
      { role: "user", content: user },
      { role: "assistant", content: assistant?.data?.content }
    ];

    const final_prompt = prompt_summary ?? prompt;
    const random_id = uuidv4();

    const updated_prompt = await prebuiltPromptDbService.getSpecificPrebuiltPrompt(org_id, "chatbot_suggestions");
    let ai_configuration = null;
    if (updated_prompt?.chatbot_suggestions) {
      ai_configuration = { prompt: updated_prompt.chatbot_suggestions };
    }

    const message = `Generate suggestions based on the user conversations. \n **User Conversations**: ${JSON.stringify(conversation.slice(-2))}`;
    const variables = { prompt_summary: final_prompt };
    const composed_thread_id = `${thread_id || random_id}-${sub_thread_id || random_id}`;

    const { result, usage } = await callAiMiddlewareWithUsage({
      user: message,
      bridge_id: bridge_ids.chatbot_suggestions,
      variables,
      configuration: ai_configuration,
      thread_id: composed_thread_id
    });

    const response = { data: { suggestions: result?.suggestions } };
    await sendResponse(response_format, response);

    // AFTER delivery, deliberately: billing must never sit between the customer
    // and their suggestions. Its own statement with its own catch, so a billing
    // failure is never logged as a suggestions failure.
    await debitBackgroundJob({
      job: "chatbot_suggestions",
      usage,
      billing: background_billing,
      bridge_id: bridge_ids.chatbot_suggestions
    });
  } catch (err) {
    logger.error(`Error calling function chatbotSuggestions: ${err.message}`);
  }
}

export { chatbotSuggestions };
