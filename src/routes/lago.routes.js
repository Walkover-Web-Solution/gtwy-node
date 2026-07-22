import express from "express";
import lagoController from "../controllers/lago.controller.js";

const router = express.Router();

// POST /api/lago/provision
// Body: { org_id: string }
// Creates a Lago customer + subscription + wallet (with 1000-credit grant) for the org
router.post("/provision", lagoController.provisionOrg);

// POST /api/lago/webhook/payment
// Payment-gateway webhook -> wallet top-up. Signature-verified, fails closed.
router.post("/webhook/payment", lagoController.walletTopupWebhook);

// GET /api/lago/wallet/:org_id
// Returns the org's current wallet balance (credits) for the settings UI.
router.get("/wallet/:org_id", lagoController.getWalletBalance);

export default router;
