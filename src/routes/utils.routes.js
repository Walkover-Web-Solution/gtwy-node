import express from "express";
import utilsController from "../controllers/utils.controller.js";
import * as agentConfigController from "../controllers/agentConfig.controller.js";
import { middleware, InternalAuth } from "../middlewares/middleware.js";
import validate from "../middlewares/validate.middleware.js";
import utilsValidation from "../validation/joi_validation/utils.validation.js";
import agentConfigValidation from "../validation/joi_validation/agentConfig.validation.js";
import { setModelStatusAdminBodySchema, bulkUpdateUserModelConfigurationBodySchema } from "../validation/joi_validation/modelConfig.validation.js";
import { bulkUpdateUserModelConfigurations } from "../controllers/modelConfig.controller.js";

const router = express.Router();

router.delete("/redis", middleware, InternalAuth, validate(utilsValidation.clearRedisCache), utilsController.clearRedisCache);
router.get("/redis/:id", middleware, InternalAuth, validate(utilsValidation.getRedisCache), utilsController.getRedisCache);
router.post("/call-gtwy", middleware, validate(utilsValidation.callAi), utilsController.callGtwy);
router.get(
  "/getBridgesAndVersions/:modelName",
  validate(agentConfigValidation.getAgentsByModel),
  agentConfigController.getAgentsAndVersionsByModelController
);
router.post("/token", middleware, validate(utilsValidation.generateToken), utilsController.generateToken);
router.post("/affiliate/embed-token", middleware, validate(utilsValidation.getAffiliateEmbedToken), utilsController.getAffiliateEmbedToken);
router.get("/users-details", middleware, utilsController.getCurrentOrgUsers);
router.delete(
  "/agent/:agent_id",
  middleware,
  InternalAuth,
  validate(agentConfigValidation.getAgent),
  agentConfigController.permanentlyDeleteAgentController
);
router.patch("/models/status", validate({ body: setModelStatusAdminBodySchema }), utilsController.setModelStatus);
router.post("/models/bulk-update", middleware, validate({ body: bulkUpdateUserModelConfigurationBodySchema }), bulkUpdateUserModelConfigurations);
router.get("/models/status/:status", middleware, utilsController.getModelsByStatus);

export default router;
