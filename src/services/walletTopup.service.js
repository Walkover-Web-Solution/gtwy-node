import crypto from "crypto";

import models from "../../models/index.js";
import { topupSplit, walletCredit, walletTopupTransactionId } from "./lago.service.js";

const { pg } = models;

const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET;

// Signature verification is MANDATORY (doc §7.8): without it, anyone who can
// construct a plausible payload can credit arbitrary wallets. Fail CLOSED — if
// the secret is unset or the signature is missing/wrong, reject.
//
// This is a generic HMAC-SHA256 check over the raw body. The provider-specific
// scheme (Stripe's `Stripe-Signature` t=/v1=, Razorpay's X-Razorpay-Signature,
// etc.) MUST be confirmed and swapped in for the real provider before go-live.
export const verifyWebhookSignature = (rawBody, signatureHeader) => {
  if (!PAYMENT_WEBHOOK_SECRET) {
    throw new Error("PAYMENT_WEBHOOK_SECRET is not configured — refusing to trust webhook");
  }
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha256", PAYMENT_WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex");
  // Constant-time compare to avoid timing leaks.
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signatureHeader));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Process one successful-payment webhook into a wallet top-up.
// Idempotent on gateway_event_id: a redelivered webhook resolves to the existing
// row and does not double-credit (the UNIQUE constraint is the DB-level backstop;
// Lago's transaction_id dedup is the second layer).
export const processTopup = async ({ org_id, gateway_event_id, gross_amount_usd }) => {
  if (!org_id || !gateway_event_id || gross_amount_usd == null) {
    throw new Error("processTopup requires org_id, gateway_event_id, gross_amount_usd");
  }

  const existing = await pg.wallet_topups.findOne({ where: { gateway_event_id } });
  if (existing) {
    // Already processed (redelivery). Return the prior result, do not re-credit.
    return { deduped: true, topup: existing };
  }

  const split = topupSplit(gross_amount_usd);
  const transaction_id = walletTopupTransactionId(gateway_event_id);

  // Record intent first (status=pending) so a crash between DB write and Lago
  // call leaves a durable, reconcilable row rather than a silent gap.
  const topup = await pg.wallet_topups.create({
    org_id,
    gateway_event_id,
    gross_amount_usd: split.grossUsd,
    fee_amount_usd: split.feeUsd,
    net_credits_loaded: split.netCredits,
    lago_transaction_id: transaction_id,
    status: "pending"
  });

  try {
    const lagoResponse = await walletCredit(org_id, split.netCredits, transaction_id, {
      source: "wallet_topup",
      gateway_event_id
    });
    await topup.update({ status: "credited" });
    return { deduped: false, topup, lagoResponse };
  } catch (err) {
    await topup.update({ status: "failed" });
    throw err;
  }
};
