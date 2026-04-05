import express from "express";
import agentVersionController from "../controllers/agentVersion.controller.js";
import { updateAgentController } from "../controllers/agentConfig.controller.js";
import { middleware, requireAdminRole } from "../middlewares/middleware.js";
import validate from "../middlewares/validate.middleware.js";
import bridgeVersionValidation from "../validation/joi_validation/bridgeVersion.validation.js";
import { updateBridgeSchema, bridgeIdParamSchema } from "../validation/joi_validation/agentConfig.validation.js";
import { transformAgentAdvanceParametersMiddleware, transformToFrontendFormatMiddleware } from "../services/utils/advancedParam.utils.js";

const router = express.Router();

//create Version
router.post(
  "/",
  middleware,
  requireAdminRole,
  validate(bridgeVersionValidation.createVersion),
  transformAgentAdvanceParametersMiddleware,
  agentVersionController.createVersion,
  transformToFrontendFormatMiddleware
);

//bulk publish
router.post(
  "/bulk_publish",
  middleware,
  requireAdminRole,
  validate(bridgeVersionValidation.bulkPublishVersion),
  agentVersionController.bulkPublishVersion
);

//get Version
router.get(
  "/:version_id",
  middleware,
  validate(bridgeVersionValidation.getVersion),
  agentVersionController.getVersion,
  transformToFrontendFormatMiddleware
);

//publish Version
router.post(
  "/publish/:version_id",
  middleware,
  requireAdminRole,
  validate(bridgeVersionValidation.publishVersion),
  transformAgentAdvanceParametersMiddleware,
  agentVersionController.publishVersion,
  transformToFrontendFormatMiddleware
);

//delete Version
router.delete("/:version_id", middleware, requireAdminRole, validate(bridgeVersionValidation.removeVersion), agentVersionController.removeVersion);

//discard Version
router.post(
  "/discard/:version_id",
  middleware,
  requireAdminRole,
  validate(bridgeVersionValidation.discardVersion),
  agentVersionController.discardVersion
);

//suggest Model
router.get(
  "/suggest-model/:version_id",
  middleware,
  validate(bridgeVersionValidation.suggestModel),
  agentVersionController.suggestModel,
  transformToFrontendFormatMiddleware
);

//get Connected Agents
router.get(
  "/connected-agents/:version_id",
  middleware,
  validate(bridgeVersionValidation.getConnectedAgents),
  agentVersionController.getConnectedAgents,
  transformToFrontendFormatMiddleware
);

//update Version
router.put(
  "/:version_id",
  middleware,
  requireAdminRole,
  transformAgentAdvanceParametersMiddleware,
  validate(bridgeIdParamSchema),
  validate(updateBridgeSchema),
  updateAgentController,
  transformToFrontendFormatMiddleware
);

export default router;
