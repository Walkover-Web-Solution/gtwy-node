import express from "express";
import billingController from "../controllers/billing.controller.js";
import validate from "../middlewares/validate.middleware.js";
import billingValidation from "../validation/joi_validation/billing.validation.js";
import { InternalAuth, middleware, blockEmbedUsers } from "../middlewares/middleware.js";

// JWT routes for the Pro subscription (Stripe through Lago). The Lago webhook
// is NOT here — it lives in lagoWebhook.routes.js, mounted before the JSON parser.
const router = express.Router();

// Customer: org from the token, never from the body.
router.post("/checkout", middleware, blockEmbedUsers, billingController.createCheckout);
router.post("/subscribe", middleware, blockEmbedUsers, billingController.subscribeToPro);
router.post("/cancel", middleware, blockEmbedUsers, billingController.cancelSubscription);
router.post("/resume", middleware, blockEmbedUsers, billingController.resumeSubscription);
router.post("/retry", middleware, blockEmbedUsers, billingController.retryPayment);
router.post("/portal", middleware, blockEmbedUsers, billingController.createPortal);
router.get("/subscription", middleware, blockEmbedUsers, billingController.getSubscription);
router.get("/invoices", middleware, blockEmbedUsers, billingController.getInvoices);
router.get("/credit-packs", middleware, blockEmbedUsers, billingController.getCreditPacks);
router.post("/credits", middleware, blockEmbedUsers, validate(billingValidation.buyCredits), billingController.buyCredits);

// Admin.
router.get("/admin/reconcile", middleware, blockEmbedUsers, InternalAuth, (req, res, next) => {
  req.body = { dry_run: true };
  return billingController.runReconcile(req, res, next);
});
router.post("/admin/reconcile", middleware, blockEmbedUsers, InternalAuth, validate(billingValidation.reconcile), billingController.runReconcile);
router.post(
  "/admin/events/:unique_key/replay",
  middleware,
  InternalAuth,
  validate(billingValidation.replayEvent),
  billingController.replayBillingEvent
);
router.get("/admin/:org_id/events", middleware, blockEmbedUsers, InternalAuth, validate(billingValidation.orgParam), billingController.listOrgEvents);
router.get("/admin/:org_id", middleware, blockEmbedUsers, InternalAuth, validate(billingValidation.orgParam), billingController.getOrgBillingAdmin);

export default router;
