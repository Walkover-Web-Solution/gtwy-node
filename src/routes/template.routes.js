import express from "express";
import templateController from "../controllers/template.controller.js";
import { middleware, requireAdminRole } from "../middlewares/middleware.js";
import validate from "../middlewares/validate.middleware.js";
import agentConfigValidation from "../validation/joi_validation/agentConfig.validation.js";

const router = express.Router();

router.get("/", templateController.allTemplates);
router.post(
  "/create/agent/:template_id",
  middleware,
  requireAdminRole,
  validate(agentConfigValidation.createAgentFromTemplate),
  templateController.createAgentFromTemplateController
);
router.post("/:agent_id", middleware, templateController.createTemplate);

export default router;
