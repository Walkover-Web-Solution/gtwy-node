import express from "express";
import common from "../services/commonService/configServices.js";
import { middleware } from "../middlewares/middleware.js";
import { chatBotAuth, combinedAuthWithChatBotAndPublicChatbot } from "../middlewares/interfaceMiddlewares.js";
import validate from "../middlewares/validate.middleware.js";
import conversationValidation from "../validation/joi_validation/conversation.validation.js";

let router = express.Router();

router.get("/threads/:thread_id/:bridge_id", middleware, validate(conversationValidation.getThreads), common.getThreads); // used by someone else
router.post("/threads/:thread_id/:sub_thread_id?/:bridge_id", middleware, validate(conversationValidation.createEntry), common.createEntry); //used by some else
router.get(
  "/history/sub-thread/:thread_id",
  middleware,
  validate(conversationValidation.getAllSubThreadsController),
  common.getAllSubThreadsController
); //used by someone else
router.post("/getFineTuneData/:bridge_id", middleware, validate(conversationValidation.FineTuneData), common.FineTuneData);
router.put("/gethistory/:bridge_id", middleware, validate(conversationValidation.updateThreadMessage), common.updateThreadMessage);
router.put("/status/:status", chatBotAuth, validate(conversationValidation.updateMessageStatus), common.updateMessageStatus);
router.get("/get-message-history/:thread_id/:bridge_id", middleware, validate(conversationValidation.getThreadMessages), common.getThreadMessages); //used by some else
router.get("/getuserupdates/:version_id", middleware, validate(conversationValidation.getAllUserUpdates), common.getAllUserUpdates);
router.get("/gethistory-chatbot/:thread_id/:bridge_slugName", combinedAuthWithChatBotAndPublicChatbot, common.getThreads); //Route Deprecated //Public API for getting history for particular thread

export default router;
