import express from "express";
import billingPlanController from "../controllers/billingPlan.controller.js";
import validate from "../middlewares/validate.middleware.js";
import billingPlanValidation from "../validation/joi_validation/billingPlan.validation.js";
import { InternalAuth, middleware } from "../middlewares/middleware.js";

const router = express.Router();

// Active plans, safe fields only — any signed-in user (e.g. the plans page). Must stay
// above /:plan_code, which is admin-only and would otherwise match "public" as a code.
router.get("/public", middleware, billingPlanController.listPublicBillingPlans);

// Admin-only: what each plan includes. Moving an org between plans is POST /api/lago/plan.
router.put("/", middleware, InternalAuth, validate(billingPlanValidation.setBillingPlan), billingPlanController.setBillingPlan);
router.get("/", middleware, InternalAuth, billingPlanController.listBillingPlans);
router.get("/:plan_code", middleware, InternalAuth, validate(billingPlanValidation.getBillingPlan), billingPlanController.getBillingPlan);
router.delete("/", middleware, InternalAuth, validate(billingPlanValidation.removeBillingPlan), billingPlanController.removeBillingPlan);

export default router;
