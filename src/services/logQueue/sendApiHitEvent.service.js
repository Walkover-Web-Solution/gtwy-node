import axios from "axios";
import logger from "../../logger.js";

async function sendApiHitEvent({ message_id, org_id }) {
  try {
    const baseUrl = process.env.BILLING_API_URL;
    const api_key = process.env.BILLING_API_KEY;
    const code = process.env.BILLING_EVENT_CODE;

    if (!baseUrl || !api_key || !code) return;

    await axios.post(
      `${baseUrl}/events`,
      {
        event: {
          transaction_id: message_id,
          // Canonical subscription external_id is the bare org_id (see
          // subscriptionExternalId in lago.service.js) — `sub_${org_id}`
          // pointed at a subscription that never existed, so every api-hit
          // event was silently dropped by Lago.
          external_subscription_id: String(org_id),
          code
        }
      },
      {
        headers: {
          Authorization: `Bearer ${api_key}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    logger.error(`Failed to send api hit event: ${err.message}`);
  }
}

export { sendApiHitEvent };
