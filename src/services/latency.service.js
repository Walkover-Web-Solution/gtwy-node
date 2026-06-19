import axios from "axios";
import { configDotenv } from "dotenv";
configDotenv();
import { getHistoryByMessageId } from "../db_services/history.service.js";

/**
 * Runs a single latency measurement by calling the GTWY completion API,
 * retry logic for the log to be written, then fetching the conversation log
 * to extract overall_time and model_execution_time.
 *
 * latency = overall_time - model_execution_time
 *
 * @returns {Promise<{latency: number, overall_time: number, model_execution_time: number, message_id: string}>}
 */
async function singleLatency() {
  const agent_id = process.env.LATENCY_AGENT_ID;
  const pauthkey = process.env.LATENCY_PAUTHKEY;
  const environment = process.env.ENVIRONMENT.toUpperCase();

  if (!agent_id) {
    throw new Error("LATENCY_AGENT_ID is not configured in environment variables");
  }

  if (!pauthkey) {
    throw new Error("GTWY_PAUTH_KEY is not configured in environment variables");
  }

  let baseUrl = "";
  if (environment == "TESTING") {
    baseUrl = "https://dev-api.gtwy.ai/api/v2/model/chat/completion";
  } else {
    baseUrl = "https://api.gtwy.ai/api/v2/model/chat/completion";
  }

  // Step 1: Call the completion API
  const completionResponse = await axios.post(
    baseUrl,
    {
      user: "Hi",
      agent_id: agent_id
    },
    {
      headers: {
        pauthkey: pauthkey,
        "Content-Type": "application/json"
      }
    }
  );

  if (completionResponse.data?.success === false) {
    throw new Error("Failed to get completion from API");
  }

  const messageId = completionResponse.data?.response?.data?.message_id;

  if (!messageId) {
    throw new Error("No message_id returned from completion API");
  }

  // Step 2: Wait for some time for the log to be persisted
  // retry logic for checking history logic because sometimes log might not be saved in history in 10ms
  let historyRecord = "";
  for (let i = 0; i < 20; i++) {
    historyRecord = await getHistoryByMessageId(messageId);
    if (historyRecord != null) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (!historyRecord) {
    throw new Error("History logs not found for the corresponding message_id");
  }

  const overallTime = historyRecord?.dataValues?.latency?.over_all_time ?? null;
  const modelExecutionTime = historyRecord?.dataValues?.latency?.model_execution_time ?? null;

  // Calculate latency = overall_time - model_execution_time
  const latency = overallTime !== null && modelExecutionTime !== null ? overallTime - modelExecutionTime : null;

  return {
    latency,
    overallTime,
    modelExecutionTime,
    message_id: messageId
  };
}

/**
 * Runs single_latency `count` times sequentially and returns
 * per-run results plus an average latency.
 *
 * @param {number} count - Number of times to run the latency check
 * @returns {Promise<{average_latency: number, runs: Array, count: number}>}
 */
async function runLatencyChecks(count) {
  const runs = [];
  for (let i = 0; i < count; i++) {
    try {
      const result = await singleLatency();
      runs.push({
        run: i + 1,
        ...result,
        success: true
      });
    } catch (e) {
      runs.push({
        run: i + 1,
        success: false,
        error: e.message
      });
    }
  }
  const successfulRuns = runs.filter((run) => run.success);

  const averageLatency = successfulRuns.length > 0 ? successfulRuns.reduce((sum, r) => sum + r.latency, 0) / successfulRuns.length : null;

  return {
    count,
    successful_runs: successfulRuns.length,
    failed_runs: runs.length - successfulRuns.length,
    averageLatency,
    runs
  };
}

export default { singleLatency, runLatencyChecks };
