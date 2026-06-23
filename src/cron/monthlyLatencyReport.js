import cron from "node-cron";
import { getMonthlyreports } from "../controllers/report.controller.js";

const initializeMonthlyLatencyReport = () => {
  return cron.schedule("1 0 1 * *", async () => {
    try {
      console.log("Running monthly latency report...");
      await getMonthlyreports();
    } catch (error) {
      console.error("Error generating monthly latency report:", error);
    }
  });
};

export default initializeMonthlyLatencyReport;
