import axios from "axios";
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
  
  const { bridge_id, org_id } = params;
  
  if (!bridge_id || typeof bridge_id !== "string") {
    return { isValid: false, error: "Missing or invalid bridge_id" };
  }
  if (!org_id || typeof org_id !== "string") {
    return { isValid: false, error: "Missing or invalid org_id" };
  }
  
  return { isValid: true };
}

/**
 * Broadcast response to configured webhook
 * @param {Object} data - Webhook data
 * @param {string} data.bridge_id - Bridge ID
 * @param {string} data.org_id - Organization ID
 * @param {Object} data.response - AI response
 * @param {string} data.user_question - User's question
 * @param {Object} data.variables - Variables used
 * @param {string} data.error_type - Error type if applicable
 * @param {string} data.bridge_name - Bridge name
 * @param {boolean} data.is_embed - Whether from embed
 * @param {string} data.user_id - User ID
 * @param {string} data.thread_id - Thread ID
 * @param {string} data.service - Service name
 */
async function broadcastResponseWebhook(data) {
  const validation = validateParams(data);
  if (!validation.isValid) {
    logger.warn(`broadcastResponseWebhook: ${validation.error}`);
    return;
  }

  const {
    bridge_id,
    org_id,
    response,
    user_question,
    variables,
    error_type,
    bridge_name,
    is_embed,
    user_id,
    thread_id,
    service
  } = data;

  try {
    // TODO: Get webhook URL from configuration
    // For now, this is a placeholder for webhook broadcasting
    const webhookPayload = {
      bridge_id,
      org_id,
      response,
      user_question,
      variables: variables || {},
      error_type,
      bridge_name,
      is_embed,
      user_id,
      thread_id,
      service,
      timestamp: new Date().toISOString()
    };

    // TODO: Fetch webhook URL from bridge configuration and send
    // const webhookUrl = await getWebhookUrl(bridge_id, org_id);
    // if (webhookUrl) {
    //   await axios.post(webhookUrl, webhookPayload);
    // }

    logger.debug(`Broadcast webhook prepared for bridge_id=${bridge_id}`);
    return webhookPayload;
  } catch (err) {
    logger.error(`Error in broadcastResponseWebhook: ${err.message}`);
  }
}

export { broadcastResponseWebhook };
