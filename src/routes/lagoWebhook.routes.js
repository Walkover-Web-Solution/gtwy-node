import express from "express";
import billingController from "../controllers/billing.controller.js";

// Mounted in index.js at /api/lago BEFORE express.json(): Lago signs the exact
// bytes it sent (HMAC-SHA256 in X-Lago-Signature), so the controller needs them
// as a Buffer. No JWT — authenticity comes from the signature, and anything
// unsigned is rejected with 400. Only /webhook lives here; every other
// /api/lago path falls through to lago.routes.js.
const router = express.Router();

router.post("/webhook", express.raw({ type: "application/json", limit: "1mb" }), billingController.lagoWebhook);

export default router;
