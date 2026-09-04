import axios from "axios";
import { configDotenv } from "dotenv";
configDotenv();

// NOTE: this module deliberately imports ONLY axios + dotenv. Billing lives in
// src/services/logQueue/backgroundJobBilling.service.js, not here: importing it
// would close the cycle aiCall.utils -> billingDebit.service ->
// utils/utility.service -> aiCall.utils, which ESM tolerates at the top level
// but leaves partially initialised under some load orders. Deciding whether to
// charge is business logic and belongs in the services.

const AI_MIDDLEWARE_URL = "https://api.gtwy.ai/api/v2/model/chat/completion";

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

// Callers with response_type === null expect a parsed object (chatbotSuggestions
// reads result.suggestions, callCanonicalizerAgent reads result.is_agent_level).
// Shared so the two entry points below can never diverge on this.
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

async function callAiMiddleware(
  user,
  bridge_id,
  variables = {},
  configuration = null,
  response_type = null,
  thread_id = null,
  orchestrator_flag = false
) {
  try {
    const payload = await postToAiMiddleware(
      buildRequestBody({ user, bridge_id, variables, configuration, response_type, thread_id, orchestrator_flag })
    );
    return extractResult(payload, response_type);
  } catch (error) {
    console.error("Error in callAiMiddleware:", error);
    throw new Error(error.response?.data?.message || error.message || "Unknown error");
  }
}

// Same call as callAiMiddleware, but also hands back the usage block the response
// already carries: { input_tokens, output_tokens, total_tokens, cached_tokens, cost }
// where `cost` is the USD figure gtwy-ai already computed (expectedCost, cumulative
// across tool loops and reviewer rounds; 0 on a cache hit). Background jobs use it
// to bill the triggering customer — see backgroundJobBilling.service.js.
//
// Named args, because callAiMiddleware's 7 positional params would mean six nulls
// to reach anything new. callAiMiddleware's signature and return type are
// deliberately left untouched: it has ~10 live call sites.
async function callAiMiddlewareWithUsage({
  user,
  bridge_id,
  variables = {},
  configuration = null,
  response_type = null,
  thread_id = null,
  orchestrator_flag = false
}) {
  try {
    const payload = await postToAiMiddleware(
      buildRequestBody({ user, bridge_id, variables, configuration, response_type, thread_id, orchestrator_flag })
    );
    // `?? {}` so a missing/renamed usage block can never turn a working job into
    // a throwing one — billing degrades, the job does not.
    return { result: extractResult(payload, response_type), usage: payload.response?.usage ?? {} };
  } catch (error) {
    console.error("Error in callAiMiddlewareWithUsage:", error);
    throw new Error(error.response?.data?.message || error.message || "Unknown error");
  }
}

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
