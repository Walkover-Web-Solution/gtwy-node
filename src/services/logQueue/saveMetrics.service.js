import models from "../../../models/index.js";
import logger from "../../logger.js";

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
        latency: row.latency ?? 0,
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
    .map((row) => ({
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
      latency: row.latency ?? 0,
      success: row.success ?? false,
      cost: row.cost ?? 0
    }));

  if (rows.length === 0) return;

  try {
    await models.timescale.raw_data.bulkCreate(rows);
  } catch (err) {
    logger.error(`Error saving batch metrics to timescale: ${err.message}`);
  }
}

export { saveMetrics, saveFlatMetrics };
