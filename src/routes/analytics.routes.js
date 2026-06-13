import express from "express";
import { middleware } from "../middlewares/middleware.js";
import validate from "../middlewares/validate.middleware.js";
import analyticsController from "../controllers/analytics.controller.js";
import analyticsValidation from "../validation/joi_validation/analytics.validation.js";

const router = express.Router();

router.post("/:agent_id", middleware, validate(analyticsValidation.getAgentAnalytics), analyticsController.getAgentAnalytics);

export default router;
