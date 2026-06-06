import express from "express";
import observabilityController from "../controllers/observability.controller.js";
import validate from "../middlewares/validate.middleware.js";
import observabilityValidation from "../validation/joi_validation/observability.validation.js";
import rateLimit from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

// Limit log creation to 50 requests per minute per IP (create API only).
const createRateLimit = rateLimit({ limit: 50, windowSeconds: 60, keyPrefix: "observability_create" });

// Public routes (no auth) — SDK ingests and reads agent observability logs.
router.post("/", createRateLimit, validate(observabilityValidation.createLog), observabilityController.createLog);
// List all logs (paginated); pass ?log_id=... to filter. Defined before /:log_id.
router.get("/", validate(observabilityValidation.listLogs), observabilityController.listLogs);
router.get("/:log_id", validate(observabilityValidation.getLogs), observabilityController.getLogs);

export default router;
