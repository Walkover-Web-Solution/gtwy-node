import models from "../../../models/index.js";
import logger from "../../logger.js";

/**
 * Validates a single batch update item
 * @param {Object} item - The batch update item to validate
 * @returns {Object} - { isValid: boolean, error?: string }
 */
function validateUpdateItem(item) {
  if (!item || typeof item !== "object") {
    return { isValid: false, error: "Invalid item: expected an object" };
  }
  
  const { batch_id, message_id, update_data } = item;
  
  if (!batch_id || typeof batch_id !== "string") {
    return { isValid: false, error: "Missing or invalid batch_id" };
  }
  if (!message_id || typeof message_id !== "string") {
    return { isValid: false, error: "Missing or invalid message_id" };
  }
  if (!update_data || typeof update_data !== "object") {
    return { isValid: false, error: "Missing or invalid update_data" };
  }
  
  return { isValid: true };
}

/**
 * Update a single conversation log by batch_id and message_id
 * @param {string} batch_id - The batch ID
 * @param {string} message_id - The message ID
 * @param {Object} update_data - Data to update
 */
async function updateConversationLogByBatchData(batch_id, message_id, update_data) {
  try {
    if (!batch_id || !message_id || !update_data) {
      logger.warn("updateConversationLogByBatchData: Missing required parameters");
      return null;
    }

    // Build the update object
    const updateFields = {};
    
    if (update_data.llm_message !== undefined) {
      updateFields.llm_message = update_data.llm_message;
    }
    if (update_data.chatbot_message !== undefined) {
      updateFields.chatbot_message = update_data.chatbot_message;
    }
    if (update_data.status !== undefined) {
      updateFields.status = update_data.status;
    }
    if (update_data.error !== undefined) {
      updateFields.error = update_data.error;
    }
    if (update_data.finish_reason !== undefined) {
      updateFields.finish_reason = update_data.finish_reason;
    }
    if (update_data.tokens !== undefined) {
      updateFields.tokens = update_data.tokens;
    }

    // Update the conversation log
    const result = await models.pg.conversation_logs.update(updateFields, {
      where: {
        message_id: message_id
      }
    });

    logger.debug(`Updated conversation log: batch_id=${batch_id}, message_id=${message_id}, rows=${result[0]}`);
    return result;
  } catch (err) {
    logger.error(`Error updating conversation log for batch ${batch_id}: ${err.message}`);
    throw err;
  }
}

/**
 * Update batch history records in PostgreSQL
 * Handles updates to conversation_logs for batch processing results
 * @param {Array} batchUpdates - Array of batch update objects
 * @param {string} batchUpdates[].batch_id - The batch ID
 * @param {string} batchUpdates[].message_id - The message ID
 * @param {Object} batchUpdates[].update_data - Data to update
 */
async function updateBatchHistory(batchUpdates) {
  if (!batchUpdates || !Array.isArray(batchUpdates)) {
    logger.warn("updateBatchHistory: Invalid or empty batch updates array");
    return { success: false, updated: 0, errors: [] };
  }

  if (batchUpdates.length === 0) {
    return { success: true, updated: 0, errors: [] };
  }

  const results = {
    success: true,
    updated: 0,
    errors: []
  };

  // Process each batch update
  for (const update of batchUpdates) {
    const validation = validateUpdateItem(update);
    if (!validation.isValid) {
      results.errors.push({
        batch_id: update?.batch_id,
        message_id: update?.message_id,
        error: validation.error
      });
      continue;
    }

    try {
      await updateConversationLogByBatchData(
        update.batch_id,
        update.message_id,
        update.update_data
      );
      results.updated++;
    } catch (err) {
      results.errors.push({
        batch_id: update.batch_id,
        message_id: update.message_id,
        error: err.message
      });
    }
  }

  if (results.errors.length > 0) {
    results.success = false;
    logger.warn(`updateBatchHistory completed with ${results.errors.length} errors`);
  }

  logger.info(`updateBatchHistory: Updated ${results.updated}/${batchUpdates.length} records`);
  return results;
}

export { updateBatchHistory, updateConversationLogByBatchData };
