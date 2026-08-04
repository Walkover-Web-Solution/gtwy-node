import express from "express";
import { middleware } from "../middlewares/middleware.js";
import validate from "../middlewares/validate.middleware.js";
import huggingfaceController from "../controllers/huggingface.controller.js";
import huggingfaceValidation from "../validation/joi_validation/huggingface.validation.js";

const router = express.Router();
router.get(
  "/models/providers",
  middleware,
  validate(huggingfaceValidation.getHuggingFaceModelProviders),
  huggingfaceController.getHuggingFaceModelProviders
);

export default router;
