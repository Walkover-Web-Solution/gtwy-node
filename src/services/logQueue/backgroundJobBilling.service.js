import { v4 as uuidv4 } from "uuid";

import logger from "../../logger.js";
import { processBillingEvents } from "./billingDebit.service.js";

// Background AI jobs run on our platform keys; this bills them to the org that
// triggered them, priced the same way gtwy-ai prices a main call.

const CREDIT_RATE_USD = Number(process.env.LAGO_CREDIT_RATE_USD);
const CREDIT_QUANTUM = 10000; // 4 decimal places, matching Python's _CREDIT_QUANTUM

// GTWY's cut on top of the provider cost. Must match gtwy-ai's GTWY_COMMISSION_PCT.
const COMMISSION_PCT = Number(process.env.GTWY_COMMISSION_PCT ?? 0);
const COMMISSION_MULTIPLIER = 1 + (Number.isFinite(COMMISSION_PCT) ? COMMISSION_PCT : 0) / 100;

// Half-up rounding to 4dp, matching Python's ROUND_HALF_UP on positive costs.
const round4 = (n) => Math.round(n * CREDIT_QUANTUM) / CREDIT_QUANTUM;

// A set-but-nonsensical commission must fail loudly rather than quietly bill at cost.
if (process.env.GTWY_COMMISSION_PCT != null && String(process.env.GTWY_COMMISSION_PCT).trim() !== "") {
  if (!Number.isFinite(COMMISSION_PCT) || COMMISSION_PCT < 0 || COMMISSION_PCT > 100) {
    throw new Error(`GTWY_COMMISSION_PCT must be a number between 0 and 100 (got ${process.env.GTWY_COMMISSION_PCT})`);
  }
}
logger.info(
  `[billing] credit rate $${CREDIT_RATE_USD} per credit, GTWY commission ${COMMISSION_PCT}% ` +
    `(multiplier ${COMMISSION_MULTIPLIER}). gtwy-ai must match.`
);

// USD cost -> credits: round to credits first, then apply the commission, as Python does.
const toCredits = (cost_usd) => {
  const base = round4(cost_usd / CREDIT_RATE_USD);
  return { base: base.toFixed(4), charged: round4(base * COMMISSION_MULTIPLIER).toFixed(4) };
};

// Debit the triggering org for one background AI call. Never throws.
async function debitBackgroundJob({ job, usage, billing, bridge_id }) {
  try {
    // No attribution block: the customer ran on their own API key, so nothing to bill.
    if (!billing?.org_id) return;

    const cost_usd = Number(usage?.cost);
    // Cache hits come back with cost 0 — genuinely free.
    if (!Number.isFinite(cost_usd) || cost_usd <= 0) return;

    if (!Number.isFinite(CREDIT_RATE_USD) || CREDIT_RATE_USD <= 0) {
      logger.error(`[billing] bg debit skipped for org=${billing.org_id} job=${job}: LAGO_CREDIT_RATE_USD is missing or invalid`);
      return;
    }

    const { base, charged: credits } = toCredits(cost_usd);
    if (Number(credits) <= 0) return;

    // Random, not derived: a redelivery re-runs the job and spends real money again.
    const transaction_id = `bgjob-${job}-${billing.message_id || "no-msg"}-${uuidv4()}`;

    await processBillingEvents([
      {
        type: "background_job_debit",
        job,
        transaction_id,
        org_id: billing.org_id,
        credits,
        // The real provider cost, never with the commission folded in.
        cost_usd: String(cost_usd),
        base_credits: base,
        commission_pct: String(COMMISSION_PCT),
        message_id: billing.message_id,
        bridge_id,
        user_id: billing.user_id,
        folder_id: billing.folder_id,
        is_embed: billing.is_embed
      }
    ]);

    logger.info(
      `[billing] bg debit org=${billing.org_id} job=${job} base=${base} +${COMMISSION_PCT}% ` +
        `credits=${credits} cost_usd=${cost_usd} tx=${transaction_id}`
    );
  } catch (err) {
    // Billing must never break the job it is billing for.
    logger.error(`[billing] bg debit failed for job=${job} org=${billing?.org_id}: ${err.message}`);
  }
}

export { debitBackgroundJob };
