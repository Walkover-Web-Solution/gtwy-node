import express from "express";
import lagoController from "../controllers/lago.controller.js";
import validate from "../middlewares/validate.middleware.js";
import lagoValidation from "../validation/joi_validation/lago.validation.js";
import { InternalAuth, middleware } from "../middlewares/middleware.js";

const router = express.Router();

// MSG91 signup webhook (no JWT — the sender can't carry one). Same path the
// webhook has always pointed at; optional shared secret via
// LAGO_PROVISION_WEBHOOK_TOKEN. Provisions customer + subscription + wallet
// + free plan for every new org.
router.post("/provision", validate(lagoValidation.provisionWebhook), lagoController.provisionWebhook);

// Admin/manual provisioning ({ org_id }) — used by scripts/provisionLagoOrgs.js.
router.post("/provision/admin", middleware, InternalAuth, validate(lagoValidation.provisionOrg), lagoController.provisionOrg);

// Caller's own wallet (org resolved from the auth profile, never the URL).
router.get("/wallet", middleware, lagoController.getWalletBalance);

router.post("/wallet/topup", middleware, InternalAuth, validate(lagoValidation.topupOrgWallet), lagoController.topupOrgWallet);
router.post("/wallet/:org_id/sync", middleware, InternalAuth, validate(lagoValidation.syncWalletBalance), lagoController.syncWalletBalance);

// Re-post debits that failed against Lago (stored, never silently dropped).
router.post("/debits/replay", middleware, InternalAuth, lagoController.replayDebits);

// The only route that moves an org between plans. Provisioning deliberately
// cannot, and a top-up should not decide a plan as a side effect.
router.post("/plan", middleware, InternalAuth, validate(lagoValidation.setOrgPlan), lagoController.setOrgPlan);

// Caller's own plan, for the UI (org from the auth profile, never the URL).
// MUST be declared before /plan/:org_id — Express matches in order, so the
// param route would otherwise swallow "me" and reject the caller on InternalAuth.
router.get("/plan/me", middleware, lagoController.getMyPlan);

// Drift check: Lago plan_code vs Mongo slug vs the Redis cache.
router.get("/plan/:org_id", middleware, InternalAuth, validate(lagoValidation.getOrgPlan), lagoController.getOrgPlan);

export default router;
