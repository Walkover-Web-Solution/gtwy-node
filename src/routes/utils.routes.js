import express from "express";
import utilsController from "../controllers/utils.controller.js";
import * as agentConfigController from "../controllers/agentConfig.controller.js";
import { middleware } from "../middlewares/middleware.js";
import validate from "../middlewares/validate.middleware.js";
import utilsValidation from "../validation/joi_validation/utils.validation.js";
import agentConfigValidation from "../validation/joi_validation/agentConfig.validation.js";
import { setModelStatusAdminBodySchema } from "../validation/joi_validation/modelConfig.validation.js";

const router = express.Router();

router.delete("/redis", validate(utilsValidation.clearRedisCache), utilsController.clearRedisCache);
router.get("/redis/:id", validate(utilsValidation.getRedisCache), utilsController.getRedisCache);
router.post("/call-gtwy", middleware, validate(utilsValidation.callAi), utilsController.callGtwy);
router.get(
  "/getBridgesAndVersions/:modelName",
  validate(agentConfigValidation.getAgentsByModel),
  agentConfigController.getAgentsAndVersionsByModelController
);
router.post("/token", middleware, validate(utilsValidation.generateToken), utilsController.generateToken);
router.post("/affiliate/embed-token", middleware, validate(utilsValidation.getAffiliateEmbedToken), utilsController.getAffiliateEmbedToken);
router.get("/users-details", middleware, utilsController.getCurrentOrgUsers);
router.patch("/models/status", middleware, validate({ body: setModelStatusAdminBodySchema }), utilsController.setModelStatus);

export default router;
