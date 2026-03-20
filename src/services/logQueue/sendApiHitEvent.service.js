import axios from "axios";
import logger from "../../logger.js";

async function sendApiHitEvent({ message_id, org_id }) {
  try {
    const url = process.env.EVENTS_API_URL;
    const api_key = process.env.EVENTS_API_KEY;
    const code = process.env.EVENTS_API_CODE;

    if (!url || !api_key || !code) return;

    await axios.post(
      url,
      {
        event: {
          transaction_id: message_id,
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
