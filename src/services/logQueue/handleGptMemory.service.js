import { callAiMiddleware } from "../utils/aiCall.utils.js";
import { bridge_ids } from "../../configs/constant.js";
import prebuiltPromptDbService from "../../db_services/prebuiltPrompt.service.js";
import { refreshGptMemoryCache } from "../utils/gptMemory.service.js";
import logger from "../../logger.js";

const PAGES_HINT =
  "Store and update long-term memory as JSON with shape " +
  '{"version":2,"pages":{ "<your_key>": <value>, ... }}. ' +
  "You decide the page keys and nested structure based on what is useful to remember. " +
  "Merge new information into the relevant pages; do not wipe unrelated pages. " +
  "Prefer structured fields over free-text blobs.";

const EMPTY_PAGES_MEMORY = {
  version: 2,
  pages: {}
};

function normalizeContent(value) {
  if (value && typeof value === "object") return JSON.stringify(value);
  return value ?? "";
}

/**
 * Build the JSON string injected into the memory agent's `json_format` prompt variable.
 * Always page-shaped: { version, pages: { ... } }.
 */
function buildJsonFormatVariable(purpose) {
  if (purpose == null || purpose === "") {
    return JSON.stringify(EMPTY_PAGES_MEMORY);
  }

  if (typeof purpose === "object" && !Array.isArray(purpose)) {
    if (purpose.pages && typeof purpose.pages === "object") {
      return JSON.stringify({
        version: purpose.version ?? 2,
        pages: purpose.pages,
        ...(purpose.updated_at != null ? { updated_at: purpose.updated_at } : {})
      });
    }
    // Top-level content dict → treat as pages
    return JSON.stringify({ version: 2, pages: purpose });
  }

  // Legacy free-text memory
  return JSON.stringify({
    version: 2,
    pages: { legacy: String(purpose) }
  });
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

function resolveGptMemoryAgentOptions() {
  const bridgeId = (process.env.GPT_MEMORY_BRIDGE_ID || "").trim() || bridge_ids.gpt_memory;
  const environment = (process.env.GPT_MEMORY_ENVIRONMENT || "").trim() || null;
  const versionId = (process.env.GPT_MEMORY_VERSION_ID || "").trim() || null;
  return { bridgeId, environment, versionId };
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
    const jsonFormat = buildJsonFormatVariable(purpose);
    const variables = {
      threadID: id,
      memory: jsonFormat,
      json_format: jsonFormat,
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
    const message = `${bridgeContext}${PAGES_HINT}${memoryContext}`;

    const { bridgeId, environment, versionId } = resolveGptMemoryAgentOptions();

    const response = await callAiMiddleware(message, {
      bridge_id: bridgeId,
      variables,
      configuration,
      response_type: "text",
      environment,
      version_id: versionId
    });

    if (response === "True") {
      try {
        const { memoryId } = await refreshGptMemoryCache({
          bridge_id,
          thread_id,
          sub_thread_id,
          version_id
        });
        logger.info(
          `handleGptMemory: memory updated via tool for ${id}, refreshed cache ${memoryId}` +
            (environment ? `, environment=${environment}` : "") +
            (versionId ? `, version_id=${versionId}` : "")
        );
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
