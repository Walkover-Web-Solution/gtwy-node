import express from "express";
import { middleware } from "../middlewares/middleware.js";
import metricsController from "../controllers/metrics.controller.js";
import validate from "../middlewares/validate.middleware.js";
import metricsValidation from "../validation/joi_validation/metrics.validation.js";

const router = express.Router();

router.post("/", middleware, validate(metricsValidation.getMetricsData), metricsController.getMetricsData);
router.post("/agent", middleware, metricsController.getBridgeMetrics);
router.post("/requests-activity", middleware, validate(metricsValidation.getRequestsActivity), metricsController.getRequestsActivity);
export default router;
