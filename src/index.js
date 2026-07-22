import { configDotenv } from "dotenv";
configDotenv();

import "express-async-errors";
import express from "express";
import cors from "cors";
import "./grafana.js";
import { stopConsumers } from "./consumers/index.js";
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
import folderRoutes from "./routes/folder.routes.js";
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
import lagoRoutes from "./routes/lago.routes.js";
import batchHistoryRoutes from "./routes/batchHistory.routes.js";
import observabilityRoutes from "./routes/observability.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
const app = express();
const PORT = process.env.PORT || 7072;

let isReady = true;

app.use(
  cors({
    origin: "*",
    maxAge: 86400,
    preflightContinue: true
  })
);
app.use(
  express.json({
    limit: "10mb",
    // Capture the raw body so payment-webhook signature verification can run
    // against the exact bytes the gateway signed (doc §7.8). Harmless for all
    // other routes.
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);
app.use(express.urlencoded({ limit: "10mb", extended: true }));
// app.use(multer().array());
try {
  mongoose.set("strictQuery", false);
  mongoose.connect(config.mongo.uri, {});
} catch (err) {
  console.error("database connection error: ", err.message);
  // logger.error('database connection error: ' + err.message);
}

app.get("/ready", (req, res) => {
  if (!isReady) return res.status(502).send("shutting down");
  res.status(200).send("ok");
});

app.get("/healthcheck", (req, res) => {
  res.status(200).send("OK running good...v1.1"); // always 200
});
app.use("/api/v1/config", converstaionRoutes);
app.use("/api/agent", configRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/batch", batchHistoryRoutes);
app.use("/api/apikeys", apikeyRoutes);
app.use("/api/service", serviceRoutes);
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/embed", embedRoutes);
app.use("/api/folder", folderRoutes);
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
app.use("/api/lago", lagoRoutes);
app.use("/api/observability", observabilityRoutes);
app.use("/api/analytics", analyticsRoutes);

//Metrics
// app.use('/api/v1/metrics', metrisRoutes);

app.use(responseMiddleware); // send response
app.use(notFoundMiddleware); // added at the last, so that it runs after all routes is being checked
app.use(errorHandlerMiddleware);

import { initModelConfiguration, backgroundListenForChanges } from "./services/utils/loadModelConfigs.js";
import { initServicesRegistry, backgroundListenForServiceChanges } from "./services/utils/loadServicesRegistry.js";

const cronTasks = [initializeMonthlyLatencyReport(), initializeWeeklyLatencyReport(), initializeDailyUpdateCron()];

initModelConfiguration();
backgroundListenForChanges();

initServicesRegistry();
backgroundListenForServiceChanges();

let server = app.listen(PORT, () => {
  console.log(`Server is running on port:${PORT}`);
});

server.keepAliveTimeout = 10 * 60 * 1000 + 30000; // 10 minutes + 5 Seconds extra than load balancer timeout

// Graceful shutdown handler
const shutdown = async (signal, reason) => {
  console.log(`\nReceived ${signal} signal, starting graceful shutdown...`);
  console.log(`Reason: ${reason}`);

  isReady = false;

  try {
    cronTasks.forEach((task) => task?.stop());
    console.log("Cron jobs stopped");

    await stopConsumers();
    console.log("Queue consumers stopped");
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
