import express from "express";
import billingController from "../controllers/billing.controller.js";
import validate from "../middlewares/validate.middleware.js";
import billingValidation from "../validation/joi_validation/billing.validation.js";
import { InternalAuth, middleware } from "../middlewares/middleware.js";

// JWT routes for the Pro subscription (Stripe through Lago). The Lago webhook
// is NOT here — it lives in lagoWebhook.routes.js, mounted before the JSON parser.
const router = express.Router();

// Customer: org from the token, never from the body.
router.post("/checkout", middleware, billingController.createCheckout);
router.post("/subscribe", middleware, billingController.subscribeToPro);
router.post("/cancel", middleware, billingController.cancelSubscription);
router.post("/resume", middleware, billingController.resumeSubscription);
router.post("/retry", middleware, billingController.retryPayment);
router.post("/portal", middleware, billingController.createPortal);
router.get("/subscription", middleware, billingController.getSubscription);
router.get("/invoices", middleware, billingController.getInvoices);
router.get("/credit-packs", middleware, billingController.getCreditPacks);
router.post("/credits", middleware, validate(billingValidation.buyCredits), billingController.buyCredits);

// Admin.
router.get("/admin/reconcile", middleware, InternalAuth, (req, res, next) => {
  req.body = { dry_run: true };
  return billingController.runReconcile(req, res, next);
});
router.post("/admin/reconcile", middleware, InternalAuth, validate(billingValidation.reconcile), billingController.runReconcile);
router.post(
  "/admin/events/:unique_key/replay",
  middleware,
  InternalAuth,
  validate(billingValidation.replayEvent),
  billingController.replayBillingEvent
);
router.get("/admin/:org_id/events", middleware, InternalAuth, validate(billingValidation.orgParam), billingController.listOrgEvents);
router.get("/admin/:org_id", middleware, InternalAuth, validate(billingValidation.orgParam), billingController.getOrgBillingAdmin);

export default router;
