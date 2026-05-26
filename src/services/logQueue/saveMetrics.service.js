import models from "../../../models/index.js";
import logger from "../../logger.js";
import rabbitMqProducer from "../queue.service.js";
import Helper from "../utils/helper.utils.js";
import { sendAlert } from "../utils/utility.service.js";

function normalizeRow(row) {
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
    latency: row.latency ?? 0,
    success: row.success ?? false,
    cost: row.cost ?? 0,
    time_zone: row.time_zone ?? null
  };
}

function processMetrics(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.filter((r) => r && r.org_id).map(normalizeRow);
}

async function saveMetrics(rows) {
  if (!rows || rows.length === 0) return;
  try {
    await models.timescale.raw_data.bulkCreate(rows);
  } catch (err) {
    logger.error(`[MetricsQueue] Failed to save metrics to timescale: ${err.message}`);
    throw err;
  }
}

/**
 * Publish a failed metrics batch to the dead-letter queue for later inspection.
 * Returns true on success, false otherwise.
 */
async function publishFailedMetrics(rows, error) {
  const serializedError = Helper.serializeError(error);
  const metricsQueue = process.env.METRICS_QUEUE_NAME;
  if (!metricsQueue) {
    logger.error("[MetricsQueue] METRICS_QUEUE_NAME is not configured; cannot shift failed batch.");
    return false;
  }
  const failedQueue = `${metricsQueue}-failed`;
  try {
    await rabbitMqProducer.publishToQueue(failedQueue, {
      failed_rows: rows,
      error: serializedError,
      failed_at: new Date().toISOString()
    });
    logger.warn(`[MetricsQueue] ${rows.length} rows shifted to ${failedQueue}`);
    await sendAlert(`[MetricsQueue] Bulk insert failed — ${rows.length} rows shifted to ${failedQueue}.`, serializedError, null, null, null);
    return true;
  } catch (publishErr) {
    logger.error(`[MetricsQueue] Failed to publish to dead-letter queue: ${publishErr.message}. Dropping ${rows.length} rows.`);
    return false;
  }
}

export { processMetrics, saveMetrics, publishFailedMetrics };
