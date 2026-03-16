import logger from "../../logger.js";

/**
 * Validates the input parameters
 * @param {Object} params - The parameters to validate
 * @returns {Object} - { isValid: boolean, error?: string }
 */
function validateParams(params) {
  if (!params || typeof params !== "object") {
    return { isValid: false, error: "Invalid params: expected an object" };
  }
  
  const { message_id, org_id } = params;
  
  if (!message_id || typeof message_id !== "string") {
    return { isValid: false, error: "Missing or invalid message_id" };
  }
  if (!org_id || typeof org_id !== "string") {
    return { isValid: false, error: "Missing or invalid org_id" };
  }
  
  return { isValid: true };
}

/**
 * Send API hit event for analytics/tracking
 * @param {Object} data - Event data
 * @param {string} data.message_id - Message ID
 * @param {string} data.org_id - Organization ID
 */
async function sendApiHitEvent(data) {
  const validation = validateParams(data);
  if (!validation.isValid) {
    logger.warn(`sendApiHitEvent: ${validation.error}`);
    return;
  }

  const { message_id, org_id } = data;

  try {
    // TODO: Implement actual API hit event tracking
    // This could send events to analytics service, RTLayer, or similar
    logger.debug(`API hit event: message_id=${message_id}, org_id=${org_id}`);
  } catch (err) {
    logger.error(`Error in sendApiHitEvent: ${err.message}`);
  }
}

export { sendApiHitEvent };
