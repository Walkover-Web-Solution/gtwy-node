import express from "express";
import billingController from "../controllers/billing.controller.js";

// Mounted in index.js BEFORE express.json(): Stripe signs the exact bytes it
// sent, and constructEvent needs them as a Buffer. No JWT — authenticity comes
// from the signature, and the controller rejects anything unsigned with 400.
const router = express.Router();

router.post("/webhook", express.raw({ type: "application/json", limit: "1mb" }), billingController.stripeWebhook);

export default router;
