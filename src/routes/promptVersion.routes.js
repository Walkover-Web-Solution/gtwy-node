import express from "express";
import promptVersionController from "../controllers/promptVersion.controller.js";
import { middleware } from "../middlewares/middleware.js";
import validate from "../middlewares/validate.middleware.js";
import promptVersionValidation from "../validation/joi_validation/promptVersion.validation.js";

const router = express.Router();

// bridge_id is the parent agent id; ?version_id= narrows to prompts saved on one version
// prettier-ignore
router.get("/:bridge_id", middleware, validate(promptVersionValidation.listPromptVersions), promptVersionController.listPromptVersions);

export default router;
