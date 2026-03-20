import cron from "node-cron";
import moveDataRedisToMongodb from "../controllers/movedataRedistoMongodb.js";
import { collectionNames, redis_keys } from "../configs/constant.js";

const initializeDailyUpdateCron = () => {
  cron.schedule("*/15 * * * *", async () => {
    // Every 15 minutes instead of every minute
    try {
      console.log("Running initializeDailyUpdateCron...");
      // await moveDataRedisToMongodb(redis_keys.bridgeusedcost_, collectionNames.configuration, {
      //   bridge_usage: { type: "number" }
      // });
      // await moveDataRedisToMongodb(redis_keys.folderusedcost_, collectionNames.Folder, {
      //   folder_usage: { type: "number" }
      // });
      // await moveDataRedisToMongodb(redis_keys.apikeyusedcost_, collectionNames.ApikeyCredentials, {
      //   apikey_usage: { type: "number" }
      // });
      await moveDataRedisToMongodb(redis_keys.apikeylastused_, collectionNames.ApikeyCredentials, {
        last_used: { type: "date" }
      });
      await moveDataRedisToMongodb(redis_keys.bridgelastused_, collectionNames.configuration, {
        last_used: { type: "date" }
      });
    } catch (error) {
      console.error("Error running initializeDailyUpdateCron:", error);
    }
  });
};

export default initializeDailyUpdateCron;
