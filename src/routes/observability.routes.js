import express from "express";
import observabilityController from "../controllers/observability.controller.js";
import validate from "../middlewares/validate.middleware.js";
import observabilityValidation from "../validation/joi_validation/observability.validation.js";

const router = express.Router();

// Public routes (no auth) — SDK ingests and reads agent observability logs.
router.post("/", validate(observabilityValidation.createLog), observabilityController.createLog);
router.get("/:log_id", validate(observabilityValidation.getLogs), observabilityController.getLogs);

export default router;
