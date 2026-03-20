import axios from "axios";
import logger from "../../logger.js";

async function validateResponse({ alert_flag, configration, bridgeId, message_id, org_id }) {
  if (!alert_flag) return;

  try {
    const data = {
      response: "\n..\n",
      configration,
      message_id,
      bridge_id: bridgeId,
      org_id,
      message: "\n issue occurs",
      ENVIROMENT: process.env.ENVIROMENT
    };

    await axios.post("https://flow.sokt.io/func/scriYP8m551q", data);
  } catch (err) {
    logger.error(`Error in validateResponse alert: ${err.message}`);
  }
}

export { validateResponse };
