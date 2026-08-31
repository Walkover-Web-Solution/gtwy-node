import express from "express";
import { middleware } from "../middlewares/middleware.js";
import historyController from "../controllers/history.controller.js";
import validate from "../middlewares/validate.middleware.js";
import historyValidation from "../validation/joi_validation/history.validation.js";
import { combinedAuthWithChatBotAndPublicChatbot } from "../middlewares/interfaceMiddlewares.js";

const router = express.Router();

router.get("/:thread_id/:bridge_slugName", combinedAuthWithChatBotAndPublicChatbot, historyController.getChatbotThreadHistory);
router.get("/message/testcase/history/message_id/:message_id", middleware, historyController.getHistoryByMessageId);

router.get(
  "/recursive/:agent_id/:thread_id/:message_id",
  middleware,
  validate(historyValidation.getRecursiveAgentHistory),
  historyController.getRecursiveAgentHistory
);
router.get("/:agent_id", middleware, validate(historyValidation.getRecentThreads), historyController.getRecentThreads);
router.get(
  "/:agent_id/:thread_id/:sub_thread_id",
  middleware,
  validate(historyValidation.getConversationLogs),
  historyController.getConversationLogs
);
export default router;
