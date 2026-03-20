import "express-async-errors";
import express from "express";
import cors from "cors";
import { configDotenv } from "dotenv";
import "./grafana.js";
import "./consumers/index.js";
import "./services/cache.service.js";
import configRoutes from "./routes/config.routes.js";
import apikeyRoutes from "./routes/apikey.routes.js";
import threadRoutes from "./routes/thread.routes.js";
import metricsRoutes from "./routes/metrics.routes.js";
import mongoose from "mongoose";
import config from "../config/config.js";
import chatbotRoutes from "./routes/chatBot.routes.js";
import ragRouter from "./routes/rag.routes.js";
import clientAuthRoutes from "./routes/userOrgLocal.routes.js";
import initializeMonthlyLatencyReport from "./cron/monthlyLatencyReport.js";
import initializeWeeklyLatencyReport from "./cron/weeklyLatencyReport.js";
import initializeDailyUpdateCron from "./cron/initializeDailyUpdateCron.js";
import authRouter from "./routes/auth.routes.js";
import notFoundMiddleware from "./middlewares/notFound.js";
import errorHandlerMiddleware from "./middlewares/errorHandler.js";
import responseMiddleware from "./middlewares/responseMiddleware.js";
import alertingRoutes from "./routes/alerting.routes.js";
import testcaseRoutes from "./routes/testcase.routes.js";
import reportRoute from "./routes/report.routes.js";
import modelsRoutes from "./routes/modelConfig.routes.js";
import embedRoutes from "./routes/embed.routes.js";
import historyRoutes from "./routes/history.routes.js";
import apiCallRoutes from "./routes/apiCall.routes.js";
import agentVersionRoutes from "./routes/agentVersion.routes.js";
import utilsRoutes from "./routes/utils.routes.js";
import prebuiltPromptRoutes from "./routes/prebuiltPrompt.routes.js";
import runAgentsRoutes from "./routes/runAgents.routes.js";
import templateRoute from "./routes/template.routes.js";
import serviceRoutes from "./routes/service.routes.js";
import converstaionRoutes from "./routes/conversation.routes.js";
import internalRoutes from "./routes/internal.routes.js";
import promptWrapperRoutes from "./routes/promptWrapper.routes.js";
import richUiTemplateRoutes from "./routes/richUiTemplate.routes.js";
const app = express();
configDotenv();
const PORT = process.env.PORT || 7072;

app.use(
  cors({
    origin: "*",
    maxAge: 86400,
    preflightContinue: true
  })
);
app.use(express.json());
// app.use(multer().array());
try {
  mongoose.set("strictQuery", false);
  mongoose.connect(config.mongo.uri, {});
} catch (err) {
  console.error("database connection error: ", err.message);
  // logger.error('database connection error: ' + err.message);
}

app.get("/healthcheck", async (req, res) => {
  res.status(200).send("OK running good...v1.1");
});
app.use("/api/v1/config", converstaionRoutes);
app.use("/api/agent", configRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/apikeys", apikeyRoutes);
app.use("/api/service", serviceRoutes);
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/embed", embedRoutes);
app.use("/api/user", clientAuthRoutes);
app.use("/api/alerting", alertingRoutes);
app.use("/api/thread", threadRoutes);
app.use("/api/metrics", metricsRoutes);
app.use("/api/org", authRouter);
app.use("/api/rag", ragRouter);
app.use("/api/testcases", testcaseRoutes);
app.use("/api/report", reportRoute);
app.use("/api/models", modelsRoutes);
app.use("/api/auth", authRouter);
app.use("/api/tools", apiCallRoutes);
app.use("/api/versions", agentVersionRoutes);
app.use("/api/utils", utilsRoutes);
app.use("/api/prebuilt_prompt", prebuiltPromptRoutes);
app.use("/api/runagents", runAgentsRoutes);
app.use("/api/template", templateRoute);
app.use("/api/prompt_wrappers", promptWrapperRoutes);
app.use("/api/internal", internalRoutes);
app.use("/api/rich_ui_templates", richUiTemplateRoutes);

//Metrics
// app.use('/api/v1/metrics', metrisRoutes);

app.use(responseMiddleware); // send response
app.use(notFoundMiddleware); // added at the last, so that it runs after all routes is being checked
app.use(errorHandlerMiddleware);

import { initModelConfiguration, backgroundListenForChanges } from "./services/utils/loadModelConfigs.js";

initializeMonthlyLatencyReport();
initializeWeeklyLatencyReport();
initializeDailyUpdateCron();

initModelConfiguration();
backgroundListenForChanges();

const server = app.listen(PORT, () => {
  console.log(`Server is running on port:${PORT}`);
});

// Graceful shutdown handler
const shutdown = async (signal, reason) => {
  console.log(`\nReceived ${signal} signal, starting graceful shutdown...`);
  console.log(`Reason: ${reason}`);

  try {
    // Close database connection
    await mongoose.connection.close();
    console.log("Database connection closed successfully");

    // Close server
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
    console.log("Server closed successfully");

    // Exit process
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
};

// Handle different types of shutdown signals
process.on("SIGINT", () => shutdown("SIGINT", "User initiated shutdown (Ctrl+C)"));
process.on("SIGTERM", () => shutdown("SIGTERM", "System shutdown"));
process.on("SIGQUIT", () => shutdown("SIGQUIT", "Quit signal"));
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  shutdown("uncaughtException", `Uncaught exception: ${error.message}`);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  shutdown("unhandledRejection", `Unhandled rejection: ${reason}`);
});
