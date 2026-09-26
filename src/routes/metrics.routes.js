import express from "express";
import { middleware } from "../middlewares/middleware.js";
import metricsController from "../controllers/metrics.controller.js";
import validate from "../middlewares/validate.middleware.js";
import metricsValidation from "../validation/joi_validation/metrics.validation.js";

const router = express.Router();

router.post("/", middleware, validate(metricsValidation.getMetricsData), metricsController.getMetricsData);
router.post("/user", middleware, validate(metricsValidation.getUserMetrics), metricsController.getUserMetrics);
router.post("/agent", middleware, metricsController.getBridgeMetrics);

export default router;
