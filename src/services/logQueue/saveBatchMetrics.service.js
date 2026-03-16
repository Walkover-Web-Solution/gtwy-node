import models from "../../../models/index.js";
import logger from "../../logger.js";

/**
 * Validates a single metrics item
 * @param {Object} item - The metrics item to validate
 * @returns {Object} - { isValid: boolean, error?: string }
 */
function validateMetricsItem(item) {
  if (!item || typeof item !== "object") {
    return { isValid: false, error: "Invalid item: expected an object" };
  }
  
  const { org_id, model } = item;
  
  if (!org_id || typeof org_id !== "string") {
    return { isValid: false, error: "Missing or invalid org_id" };
  }
  if (!model || typeof model !== "string") {
    return { isValid: false, error: "Missing or invalid model" };
  }
  
  return { isValid: true };
}

/**
 * Save metrics data to Timescale DB
 * @param {Array} metricsData - Array of metrics objects to save
 */
async function timescaleMetrics(metricsData) {
  if (!metricsData || !Array.isArray(metricsData) || metricsData.length === 0) {
    return { success: true, saved: 0 };
  }

  try {
    // Validate and transform each metrics item
    const validMetrics = [];
    
    for (const item of metricsData) {
      const validation = validateMetricsItem(item);
      if (!validation.isValid) {
        logger.warn(`timescaleMetrics: Skipping invalid item - ${validation.error}`);
        continue;
      }

      validMetrics.push({
        org_id: item.org_id,
        bridge_id: item.bridge_id || "",
        version_id: item.version_id || "",
        thread_id: item.thread_id || "",
        model: item.model,
        input_tokens: parseFloat(item.input_tokens) || 0,
        output_tokens: parseFloat(item.output_tokens) || 0,
        total_tokens: parseFloat(item.total_tokens) || 0,
        apikey_id: item.apikey_id || "",
        created_at: item.created_at || new Date(),
        latency: parseFloat(item.latency) || 0,
        success: Boolean(item.success),
        cost: parseFloat(item.cost) || 0,
        service: item.service || ""
      });
    }

    if (validMetrics.length === 0) {
      return { success: true, saved: 0 };
    }

    // Bulk insert into Timescale raw_data table
    await models.timescale.raw_data.bulkCreate(validMetrics);

    logger.info(`timescaleMetrics: Saved ${validMetrics.length} metrics records`);
    return { success: true, saved: validMetrics.length };
  } catch (err) {
    logger.error(`Error in timescaleMetrics: ${err.message}`);
    throw err;
  }
}

/**
 * Save batch metrics to Timescale DB
 * @param {Array} metricsData - Array of batch metrics objects
 * @param {string} metricsData[].org_id - Organization ID
 * @param {string} metricsData[].bridge_id - Bridge ID
 * @param {string} metricsData[].version_id - Version ID
 * @param {string} metricsData[].thread_id - Thread ID
 * @param {string} metricsData[].model - Model name
 * @param {number} metricsData[].input_tokens - Input token count
 * @param {number} metricsData[].output_tokens - Output token count
 * @param {number} metricsData[].total_tokens - Total token count
 * @param {string} metricsData[].apikey_id - API key ID
 * @param {Date} metricsData[].created_at - Creation timestamp
 * @param {number} metricsData[].latency - Latency in ms
 * @param {boolean} metricsData[].success - Whether request was successful
 * @param {number} metricsData[].cost - Cost in currency
 * @param {string} metricsData[].service - Service name
 */
async function saveBatchMetrics(metricsData) {
  if (!metricsData || !Array.isArray(metricsData)) {
    logger.warn("saveBatchMetrics: Invalid or empty metrics array");
    return { success: false, saved: 0, errors: [] };
  }

  if (metricsData.length === 0) {
    return { success: true, saved: 0, errors: [] };
  }

  try {
    const result = await timescaleMetrics(metricsData);
    return { 
      success: true, 
      saved: result.saved,
      errors: [] 
    };
  } catch (err) {
    logger.error(`Error in saveBatchMetrics: ${err.message}`);
    return { 
      success: false, 
      saved: 0, 
      errors: [{ error: err.message }] 
    };
  }
}

export { saveBatchMetrics, timescaleMetrics };
