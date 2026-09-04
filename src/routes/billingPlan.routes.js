import express from "express";
import billingPlanController from "../controllers/billingPlan.controller.js";
import validate from "../middlewares/validate.middleware.js";
import billingPlanValidation from "../validation/joi_validation/billingPlan.validation.js";
import { InternalAuth, middleware } from "../middlewares/middleware.js";

const router = express.Router();

// What a plan includes decides what customers can spend platform credits on, so
// every route is InternalAuth (admin) only — same stance as platform provider
// keys. Changing an ORG's plan is POST /api/lago/plan, not here.
router.put("/", middleware, InternalAuth, validate(billingPlanValidation.setBillingPlan), billingPlanController.setBillingPlan);
router.get("/", middleware, InternalAuth, billingPlanController.listBillingPlans);
router.get("/:plan_code", middleware, InternalAuth, validate(billingPlanValidation.getBillingPlan), billingPlanController.getBillingPlan);
router.delete("/", middleware, InternalAuth, validate(billingPlanValidation.removeBillingPlan), billingPlanController.removeBillingPlan);

export default router;
