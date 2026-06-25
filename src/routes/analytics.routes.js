import express from "express";
import { middleware } from "../middlewares/middleware.js";
import analyticsController from "../controllers/analytics.controller.js";
import validate from "../middlewares/validate.middleware.js";
import analyticsValidation from "../validation/joi_validation/analytics.validation.js";

const router = express.Router();

// Agent analytics dashboard. Acks instantly; data is pushed over the RT layer.
router.get("/agent/:bridge_id", middleware, validate(analyticsValidation.getAgentAnalytics), analyticsController.getAgentAnalytics);

// Distinct filter options (tools + models) ever used by the bridge.
router.get(
  "/agent/:bridge_id/filters",
  middleware,
  validate(analyticsValidation.getAgentAnalyticsFilters),
  analyticsController.getAgentAnalyticsFilters
);

export default router;
