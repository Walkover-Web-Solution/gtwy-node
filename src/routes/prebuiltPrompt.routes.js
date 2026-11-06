import express from "express";
import prebuiltPromptController from "../controllers/prebuiltPrompt.controller.js";
import { middleware, blockEmbedUsers } from "../middlewares/middleware.js";
import validate from "../middlewares/validate.middleware.js";
import prebuiltPromptValidation from "../validation/joi_validation/prebuiltPrompt.validation.js";

const router = express.Router();

router.get("/", middleware, prebuiltPromptController.getPrebuiltPrompts);
router.put("/", middleware, blockEmbedUsers, validate(prebuiltPromptValidation.updatePrebuiltPrompt), prebuiltPromptController.updatePrebuiltPrompt);
router.post(
  "/reset",
  middleware,
  blockEmbedUsers,
  validate(prebuiltPromptValidation.resetPrebuiltPrompts),
  prebuiltPromptController.resetPrebuiltPrompts
);
router.get(
  "/:prompt_key",
  middleware,
  validate(prebuiltPromptValidation.getSpecificPrebuiltPrompt),
  prebuiltPromptController.getSpecificPrebuiltPrompt
);

export default router;
