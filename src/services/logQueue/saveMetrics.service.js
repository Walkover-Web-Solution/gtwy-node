import models from "../../../models/index.js";
import logger from "../../logger.js";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumToolCallLatency(functionTimeLogs) {
  if (Array.isArray(functionTimeLogs)) {
    return functionTimeLogs.reduce((sum, item) => {
      if (!item || typeof item !== "object") return sum;
      return sum + toNumber(item.time_taken);
    }, 0);
  }

  if (functionTimeLogs && typeof functionTimeLogs === "object") {
    return Object.values(functionTimeLogs).reduce((sum, value) => {
      if (value && typeof value === "object") {
        return sum + toNumber(value.time_taken);
      }
      return sum + toNumber(value);
    }, 0);
  }

  return 0;
}

function deriveLatency(row) {
  if (row && row.latency && typeof row.latency === "object") {
    const overallLatency = toNumber(row.latency.over_all_time);
    const llmLatency = toNumber(row.latency.model_execution_time);
    const toolCallLatency = sumToolCallLatency(row.latency.function_time_logs);
    const systemLatency = Math.max(overallLatency - llmLatency - toolCallLatency, 0);

    return {
      latency: overallLatency,
      llm_latency: llmLatency,
      tool_call_latency: toolCallLatency,
      system_latency: systemLatency
    };
  }

  const overallLatency = toNumber(row?.latency);
  const llmLatency = toNumber(row?.llm_latency);
  const toolCallLatency = toNumber(row?.tool_call_latency);
  const systemLatency =
    row?.system_latency !== undefined && row?.system_latency !== null
      ? toNumber(row.system_latency)
      : Math.max(overallLatency - llmLatency - toolCallLatency, 0);

  return {
    latency: overallLatency,
    llm_latency: llmLatency,
    tool_call_latency: toolCallLatency,
    system_latency: systemLatency
  };
}

/**
 * Save metrics entries to TimescaleDB.
 * Called for each history entry that contains a metrics_data array.
 *
 * @param {Array} historyEntries - Array of history payload objects (each has metrics_data array)
 */
async function saveMetrics(historyEntries) {
  if (!historyEntries || historyEntries.length === 0) return;

  const metricsRows = [];

  for (const entry of historyEntries) {
    const metricsData = entry.metrics_data;
    if (!Array.isArray(metricsData) || metricsData.length === 0) continue;

    for (const row of metricsData) {
      if (!row || !row.org_id) continue;

      const derivedLatency = deriveLatency(row);

      metricsRows.push({
        org_id: row.org_id ?? null,
        bridge_id: row.bridge_id ?? null,
        version_id: row.version_id ?? null,
        thread_id: row.thread_id ?? null,
        model: row.model ?? null,
        service: row.service ?? null,
        input_tokens: row.input_tokens ?? 0,
        output_tokens: row.output_tokens ?? 0,
        total_tokens: row.total_tokens ?? 0,
        apikey_id: row.apikey_id ?? null,
        latency: derivedLatency.latency,
        llm_latency: derivedLatency.llm_latency,
        tool_call_latency: derivedLatency.tool_call_latency,
        system_latency: derivedLatency.system_latency,
        success: row.success ?? false,
        cost: row.cost ?? 0
      });
    }
  }

  if (metricsRows.length === 0) return;

  try {
    await models.timescale.raw_data.bulkCreate(metricsRows);
  } catch (err) {
    logger.error(`Error saving metrics to timescale: ${err.message}`);
  }
}

/**
 * Save a flat array of metrics rows directly to TimescaleDB.
 * Used for batch results where metrics are already fully built.
 *
 * @param {Array} metricsArray - Array of metrics row objects
 */
async function saveFlatMetrics(metricsArray) {
  if (!Array.isArray(metricsArray) || metricsArray.length === 0) return;

  const rows = metricsArray
    .filter((row) => row && row.org_id)
    .map((row) => {
      const derivedLatency = deriveLatency(row);

      return {
        org_id: row.org_id ?? null,
        bridge_id: row.bridge_id ?? null,
        version_id: row.version_id ?? null,
        thread_id: row.thread_id ?? null,
        model: row.model ?? null,
        service: row.service ?? null,
        input_tokens: row.input_tokens ?? 0,
        output_tokens: row.output_tokens ?? 0,
        total_tokens: row.total_tokens ?? 0,
        apikey_id: row.apikey_id ?? null,
        latency: derivedLatency.latency,
        llm_latency: derivedLatency.llm_latency,
        tool_call_latency: derivedLatency.tool_call_latency,
        system_latency: derivedLatency.system_latency,
        success: row.success ?? false,
        cost: row.cost ?? 0
      };
    });

  if (rows.length === 0) return;

  try {
    await models.timescale.raw_data.bulkCreate(rows);
  } catch (err) {
    logger.error(`Error saving batch metrics to timescale: ${err.message}`);
  }
}

export { saveMetrics, saveFlatMetrics };
