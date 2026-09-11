import express from "express";
import billingController from "../controllers/billing.controller.js";
import validate from "../middlewares/validate.middleware.js";
import billingValidation from "../validation/joi_validation/billing.validation.js";
import { InternalAuth, middleware } from "../middlewares/middleware.js";

// JWT routes for the Pro subscription. The Stripe webhook is NOT here — it
// lives in stripeWebhook.routes.js and is mounted before the JSON parser.
const router = express.Router();

// Customer: org from the token, never from the body.
router.post("/checkout", middleware, billingController.createCheckout);
router.post("/portal", middleware, billingController.createPortal);
router.get("/subscription", middleware, billingController.getSubscription);

// Admin.
router.get("/admin/reconcile", middleware, InternalAuth, (req, res, next) => {
  req.body = { dry_run: true };
  return billingController.runReconcile(req, res, next);
});
router.post("/admin/reconcile", middleware, InternalAuth, validate(billingValidation.reconcile), billingController.runReconcile);
router.post("/admin/events/:event_id/replay", middleware, InternalAuth, validate(billingValidation.replayEvent), billingController.replayEvent);
router.get("/admin/:org_id/events", middleware, InternalAuth, validate(billingValidation.orgParam), billingController.listOrgEvents);
router.get("/admin/:org_id", middleware, InternalAuth, validate(billingValidation.orgParam), billingController.getOrgBillingAdmin);

export default router;
