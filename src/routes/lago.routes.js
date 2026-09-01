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

export default router;
