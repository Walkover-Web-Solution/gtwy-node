import cron from "node-cron";
import { processDueDeliveries } from "../services/notifications/delivery.service.js";
import logger from "../logger.js";

// Every minute: resend notification deliveries whose retry time has passed.
const initializeNotificationRetryCron = () => {
  let running = false;
  return cron.schedule("* * * * *", async () => {
    if (running) return; // a slow run must not overlap the next one
    running = true;
    try {
      const processed = await processDueDeliveries();
      if (processed) logger.info(`[NotificationRetryCron] processed ${processed} deliveries`);
    } catch (error) {
      logger.error(`[NotificationRetryCron] ${error.message}`);
    } finally {
      running = false;
    }
  });
};

export default initializeNotificationRetryCron;
