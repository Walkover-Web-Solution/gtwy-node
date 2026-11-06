import express from "express";
import { middleware, blockEmbedUsers } from "../middlewares/middleware.js";
import alertingController from "../controllers/alerting.controller.js";
import validate from "../middlewares/validate.middleware.js";
import alertingValidation from "../validation/joi_validation/alerting.validation.js";

const router = express.Router();

router.post("/", middleware, blockEmbedUsers, validate(alertingValidation.createAlert), alertingController.createAlert);
router.get("/", middleware, blockEmbedUsers, alertingController.getAllAlerts);
router.put("/:id", middleware, blockEmbedUsers, validate(alertingValidation.updateAlert), alertingController.updateAlert);
router.delete("/", middleware, blockEmbedUsers, validate(alertingValidation.deleteAlert), alertingController.deleteAlert);

export default router;
