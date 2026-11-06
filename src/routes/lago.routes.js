import express from "express";
import lagoController from "../controllers/lago.controller.js";
import validate from "../middlewares/validate.middleware.js";
import lagoValidation from "../validation/joi_validation/lago.validation.js";
import { InternalAuth, middleware, blockEmbedUsers } from "../middlewares/middleware.js";

const router = express.Router();

// MSG91 signup webhook (no JWT; optional shared secret): provisions every new org.
router.post("/provision", validate(lagoValidation.provisionWebhook), lagoController.provisionWebhook);

// Admin/manual provisioning of one org.
router.post("/provision/admin", middleware, blockEmbedUsers, InternalAuth, validate(lagoValidation.provisionOrg), lagoController.provisionOrg);

// Caller's own wallet, org taken from the auth profile rather than the URL.
router.get("/wallet", middleware, blockEmbedUsers, lagoController.getWalletBalance);

router.post("/wallet/topup", middleware, blockEmbedUsers, InternalAuth, validate(lagoValidation.topupOrgWallet), lagoController.topupOrgWallet);
router.post(
  "/wallet/:org_id/sync",
  middleware,
  blockEmbedUsers,
  InternalAuth,
  validate(lagoValidation.syncWalletBalance),
  lagoController.syncWalletBalance
);

// Re-post debits that failed against Lago.
router.post("/debits/replay", middleware, blockEmbedUsers, InternalAuth, lagoController.replayDebits);

// The only route that moves an org between plans.
router.post("/plan", middleware, blockEmbedUsers, InternalAuth, validate(lagoValidation.setOrgPlan), lagoController.setOrgPlan);

// Caller's own plan, for the UI. Must stay above /plan/:org_id, which would otherwise match "me".
router.get("/plan/org/me", middleware, blockEmbedUsers, lagoController.getMyPlan);

// Drift check: the Lago plan against the Redis cache.
router.get("/plan/:org_id", middleware, blockEmbedUsers, InternalAuth, validate(lagoValidation.getOrgPlan), lagoController.getOrgPlan);

export default router;
