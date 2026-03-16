import { storeInCache, findInCache } from "../../cache_service/index.js";
import { redis_keys } from "../../configs/constant.js";
import logger from "../../logger.js";

const FILES_TTL = 604800; // 7 days in seconds

/**
 * Validates the input parameters
 * @param {Object} params - The parameters to validate
 * @returns {Object} - { isValid: boolean, error?: string }
 */
function validateParams(params) {
  if (!params || typeof params !== "object") {
    return { isValid: false, error: "Invalid params: expected an object" };
  }
  
  const { thread_id, sub_thread_id, bridge_id } = params;
  
  if (!thread_id || typeof thread_id !== "string") {
    return { isValid: false, error: "Missing or invalid thread_id" };
  }
  if (!sub_thread_id || typeof sub_thread_id !== "string") {
    return { isValid: false, error: "Missing or invalid sub_thread_id" };
  }
  if (!bridge_id || typeof bridge_id !== "string") {
    return { isValid: false, error: "Missing or invalid bridge_id" };
  }
  
  return { isValid: true };
}

/**
 * Save files metadata to Redis cache
 * @param {Object} data - Files data
 * @param {string} data.thread_id - Thread ID
 * @param {string} data.sub_thread_id - Sub-thread ID
 * @param {string} data.bridge_id - Bridge ID
 * @param {Array} data.files - Files array to cache
 */
async function saveFilesToRedis(data) {
  const validation = validateParams(data);
  if (!validation.isValid) {
    logger.warn(`saveFilesToRedis: ${validation.error}`);
    return;
  }

  const { thread_id, sub_thread_id, bridge_id, files } = data;

  try {
    // Skip if no files to save
    if (!files || !Array.isArray(files) || files.length === 0) {
      return;
    }

    const cache_key = `${redis_keys.files_}${bridge_id}_${thread_id}_${sub_thread_id}`;
    
    // Check existing cache
    const existingCache = await findInCache(cache_key);
    
    if (existingCache) {
      try {
        const cachedFiles = JSON.parse(existingCache);
        // If files are the same, just extend TTL
        if (JSON.stringify(cachedFiles) === JSON.stringify(files)) {
          // TTL extension handled by cache service
          return;
        }
      } catch (parseErr) {
        // Cache parse error, will overwrite
      }
    }
    
    // Store new files data
    await storeInCache(cache_key, JSON.stringify(files), FILES_TTL);
    logger.debug(`Saved ${files.length} files to cache for bridge_id=${bridge_id}`);
  } catch (err) {
    logger.error(`Error in saveFilesToRedis: ${err.message}`);
  }
}

export { saveFilesToRedis };
