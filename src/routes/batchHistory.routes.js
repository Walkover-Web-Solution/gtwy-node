import express from "express";
import { middleware } from "../middlewares/middleware.js";
import historyController from "../controllers/history.controller.js";
import validate from "../middlewares/validate.middleware.js";
import historyValidation from "../validation/joi_validation/history.validation.js";
import stripUsageForEmbed from "../middlewares/stripUsageForEmbed.js";

const router = express.Router();

router.get("/history/:agent_id", middleware, validate(historyValidation.getBatchConversationLogs), historyController.getBatchConversationLogs);

router.get(
  "/history/count/:agent_id",
  middleware,
  validate(historyValidation.getBatchConversationCountLogs),
  historyController.getBatchConversationLogsCount
);

// Runs after the controllers above call next(), before responseMiddleware.
router.use(stripUsageForEmbed);

export default router;
