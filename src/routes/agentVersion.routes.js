import express from "express";
import agentVersionController from "../controllers/agentVersion.controller.js";
import { middleware, requireAdminRole } from "../middlewares/middleware.js";
import validate from "../middlewares/validate.middleware.js";
import bridgeVersionValidation from "../validation/joi_validation/bridgeVersion.validation.js";

const router = express.Router();

//create Version
router.post("/", middleware, requireAdminRole, validate(bridgeVersionValidation.createVersion), agentVersionController.createVersion);

//bulk publish
router.post(
  "/bulk_publish",
  middleware,
  requireAdminRole,
  validate(bridgeVersionValidation.bulkPublishVersion),
  agentVersionController.bulkPublishVersion
);

//get Version
router.get("/:version_id", middleware, validate(bridgeVersionValidation.getVersion), agentVersionController.getVersion);

//publish Version
router.post(
  "/publish/:version_id",
  middleware,
  requireAdminRole,
  validate(bridgeVersionValidation.publishVersion),
  agentVersionController.publishVersion
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
router.get("/suggest-model/:version_id", middleware, validate(bridgeVersionValidation.suggestModel), agentVersionController.suggestModel);

//get Connected Agents
router.get(
  "/connected-agents/:version_id",
  middleware,
  validate(bridgeVersionValidation.getConnectedAgents),
  agentVersionController.getConnectedAgents
);

//update Version
router.put(
  "/:version_id",
  middleware,
  requireAdminRole,
  validate(bridgeVersionValidation.updateVersion),
  agentVersionController.updateVersionController
);

export default router;
