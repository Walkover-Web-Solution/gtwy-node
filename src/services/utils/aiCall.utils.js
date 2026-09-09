import axios from "axios";
import { configDotenv } from "dotenv";
configDotenv();

// Keep this module on axios + dotenv only: importing the billing services here
// closes an import cycle back through utils/utility.service.

const AI_MIDDLEWARE_URL = "https://api.gtwy.ai/api/v2/model/chat/completion";

// Assemble the chat-completion request body.
function buildRequestBody({ user, bridge_id, variables, configuration, response_type, thread_id, orchestrator_flag }) {
  const requestBody = {
    user: user,
    bridge_id: bridge_id,
    variables: variables
  };

  if (response_type !== null) {
    requestBody.response_type = response_type;
  }

  if (configuration !== null) {
    requestBody.configuration = configuration;
  }

  if (thread_id !== null) {
    requestBody.thread_id = thread_id;
  }

  if (orchestrator_flag) {
    requestBody.orchestrator_flag = orchestrator_flag;
  }

  return requestBody;
}

// POST to the AI middleware and return its payload, throwing on an unsuccessful reply.
async function postToAiMiddleware(requestBody) {
  const response = await axios.post(AI_MIDDLEWARE_URL, requestBody, {
    headers: {
      pauthkey: process.env.GTWY_PAUTH_KEY,
      "Content-Type": "application/json"
    }
  });

  if (!response.data.success) {
    throw new Error(response.data.message || "Unknown error");
  }

  return response.data;
}

// Pull the content out of a payload, parsed as JSON unless a response_type was asked for.
function extractResult(payload, response_type) {
  let result = payload.response?.data?.content || "";

  if (response_type === null) {
    try {
      result = JSON.parse(result);
    } catch {
      // Keep as string if parsing fails
    }
  }

  return result;
}

// One agent call: build, post, extract. `callerName` only labels the error log so
// the two public wrappers below keep their historical log lines.
async function requestAgent(
  { user, bridge_id, variables = {}, configuration = null, response_type = null, thread_id = null, orchestrator_flag = false },
  callerName
) {
  try {
    const payload = await postToAiMiddleware(
      buildRequestBody({ user, bridge_id, variables, configuration, response_type, thread_id, orchestrator_flag })
    );
    // `?? {}` so a missing usage block degrades billing, never the job itself.
    return { result: extractResult(payload, response_type), usage: payload.response?.usage ?? {} };
  } catch (error) {
    console.error(`Error in ${callerName}:`, error);
    throw new Error(error.response?.data?.message || error.message || "Unknown error");
  }
}

// Call an agent and return just its result.
async function callAiMiddleware(
  user,
  bridge_id,
  variables = {},
  configuration = null,
  response_type = null,
  thread_id = null,
  orchestrator_flag = false
) {
  const { result } = await requestAgent(
    { user, bridge_id, variables, configuration, response_type, thread_id, orchestrator_flag },
    "callAiMiddleware"
  );
  return result;
}

// Same call, but also returns the usage block (including the USD cost) so background
// jobs can bill the org that triggered them.
async function callAiMiddlewareWithUsage(options) {
  return requestAgent(options, "callAiMiddlewareWithUsage");
}

// Fetch an agent's stored configuration.
async function getAiMiddlewareAgentData(bridge_id) {
  try {
    const response = await axios.get(`https://db.gtwy.ai/api/agent/${bridge_id}`, {
      headers: {
        pauthkey: process.env.GTWY_PAUTH_KEY,
        "Content-Type": "application/json",
        "Accept-Encoding": "gzip"
      }
    });

    if (!response.data.success) {
      throw new Error(response.data.message || "Unknown error");
    }

    return response.data;
  } catch (error) {
    throw new Error(`Failed to fetch bridge data: ${error.response?.data?.message || error.message || "Unknown error"}`);
  }
}

export { callAiMiddleware, callAiMiddlewareWithUsage, getAiMiddlewareAgentData };
