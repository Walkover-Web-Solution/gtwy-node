import axios from "axios";
import { configDotenv } from "dotenv";
configDotenv();

async function callAiMiddleware(
  user,
  bridge_id,
  variables = {},
  configuration = null,
  response_type = null,
  thread_id = null,
  orchestrator_flag = false
) {
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

  try {
    const response = await axios.post("https://api.gtwy.ai/api/v2/model/chat/completion", requestBody, {
      headers: {
        pauthkey: process.env.GTWY_PAUTH_KEY,
        "Content-Type": "application/json"
      }
    });

    if (!response.data.success) {
      throw new Error(response.data.message || "Unknown error");
    }

    let result = response.data.response?.data?.content || "";

    if (response_type === null) {
      try {
        result = JSON.parse(result);
      } catch {
        // Keep as string if parsing fails
      }
    }

    return result;
  } catch (error) {
    console.error("Error in callAiMiddleware:", error);
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

export { callAiMiddleware, getAiMiddlewareAgentData };
