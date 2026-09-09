import express from "express";
import lagoController from "../controllers/lago.controller.js";
import validate from "../middlewares/validate.middleware.js";
import lagoValidation from "../validation/joi_validation/lago.validation.js";
import { InternalAuth, middleware } from "../middlewares/middleware.js";

const router = express.Router();

// MSG91 signup webhook (no JWT; optional shared secret): provisions every new org.
router.post("/provision", validate(lagoValidation.provisionWebhook), lagoController.provisionWebhook);

// Admin/manual provisioning of one org.
router.post("/provision/admin", middleware, InternalAuth, validate(lagoValidation.provisionOrg), lagoController.provisionOrg);

// Caller's own wallet, org taken from the auth profile rather than the URL.
router.get("/wallet", middleware, lagoController.getWalletBalance);

router.post("/wallet/topup", middleware, InternalAuth, validate(lagoValidation.topupOrgWallet), lagoController.topupOrgWallet);
router.post("/wallet/:org_id/sync", middleware, InternalAuth, validate(lagoValidation.syncWalletBalance), lagoController.syncWalletBalance);

// Re-post debits that failed against Lago.
router.post("/debits/replay", middleware, InternalAuth, lagoController.replayDebits);

// The only route that moves an org between plans.
router.post("/plan", middleware, InternalAuth, validate(lagoValidation.setOrgPlan), lagoController.setOrgPlan);

// Caller's own plan, for the UI. Must stay above /plan/:org_id, which would otherwise match "me".
router.get("/plan/me", middleware, lagoController.getMyPlan);

// Drift check: the Lago plan against the Redis cache.
router.get("/plan/:org_id", middleware, InternalAuth, validate(lagoValidation.getOrgPlan), lagoController.getOrgPlan);

export default router;
