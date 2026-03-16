import Thread from "../../mongoModel/Thread.model.js";
import logger from "../../logger.js";

/**
 * Validates the input parameters for saveSubThreadIdAndName
 * @param {Object} params - The parameters to validate
 * @returns {Object} - { isValid: boolean, error?: string }
 */
function validateParams(params) {
  if (!params || typeof params !== "object") {
    return { isValid: false, error: "Invalid params: expected an object" };
  }
  
  const { org_id, thread_id, sub_thread_id } = params;
  
  if (!org_id || typeof org_id !== "string") {
    return { isValid: false, error: "Missing or invalid org_id" };
  }
  if (!thread_id || typeof thread_id !== "string") {
    return { isValid: false, error: "Missing or invalid thread_id" };
  }
  if (!sub_thread_id || typeof sub_thread_id !== "string") {
    return { isValid: false, error: "Missing or invalid sub_thread_id" };
  }
  
  return { isValid: true };
}

/**
 * Save or update sub_thread_id and name associations for a thread
 * @param {Object} data - Thread data
 * @param {string} data.org_id - Organization ID
 * @param {string} data.thread_id - Thread ID
 * @param {string} data.sub_thread_id - Sub-thread ID
 * @param {boolean} data.thread_flag - Whether thread exists
 * @param {Object} data.response_format - Response format config
 * @param {string} data.bridge_id - Bridge ID
 * @param {string} data.user - User message
 */
async function saveSubThreadIdAndName(data) {
  const validation = validateParams(data);
  if (!validation.isValid) {
    logger.warn(`saveSubThreadIdAndName: ${validation.error}`);
    return;
  }

  const { org_id, thread_id, sub_thread_id, thread_flag, user } = data;

  try {
    // Only process if thread_flag indicates new thread
    if (thread_flag === false) {
      return;
    }

    // Check if thread already exists
    const existingThread = await Thread.findOne({
      org_id,
      thread_id,
      sub_thread_id
    });

    if (existingThread) {
      // Thread already exists, skip creation
      return;
    }

    // Create new thread entry with display_name from user message
    const displayName = user?.substring(0, 100) || "Untitled Thread";
    
    await Thread.create({
      org_id,
      thread_id,
      sub_thread_id,
      display_name: displayName,
      created_at: new Date()
    });

    logger.info(`Thread created: thread_id=${thread_id}, sub_thread_id=${sub_thread_id}`);
  } catch (err) {
    logger.error(`Error in saveSubThreadIdAndName: ${err.message}`);
  }
}

export { saveSubThreadIdAndName };
