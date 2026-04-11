import express from "express";
import { middleware, requireAdminRole } from "../middlewares/middleware.js";
import * as agentConfigController from "../controllers/agentConfig.controller.js";
import validate from "../middlewares/validate.middleware.js";
import conversationValidation from "../validation/joi_validation/conversation.validation.js";
import agentConfigValidation from "../validation/joi_validation/agentConfig.validation.js";
import { transformAgentAdvanceParametersMiddleware, transformToFrontendFormatMiddleware } from "../services/utils/advancedParam.utils.js";

const router = express.Router();

router.get("/", middleware, agentConfigController.getAllAgentController, transformToFrontendFormatMiddleware);

router.get(
  "/:agent_id",
  middleware,
  validate(agentConfigValidation.getAgent),
  agentConfigController.getAgentController,
  transformToFrontendFormatMiddleware
);

router.post(
  "/",
  middleware,
  requireAdminRole,
  validate(agentConfigValidation.createAgent),
  transformAgentAdvanceParametersMiddleware,
  agentConfigController.createAgentController,
  transformToFrontendFormatMiddleware
);

router.put(
  "/:agent_id",
  middleware,
  requireAdminRole,
  transformAgentAdvanceParametersMiddleware,
  agentConfigController.updateAgentController,
  transformToFrontendFormatMiddleware
);

router.post("/clone", middleware, requireAdminRole, validate(agentConfigValidation.cloneAgent), agentConfigController.cloneAgentController);

router.delete(
  "/:agent_id",
  middleware,
  requireAdminRole,
  validate(conversationValidation.deleteBridges),
  agentConfigController.deleteAgentController
);

export default router;
