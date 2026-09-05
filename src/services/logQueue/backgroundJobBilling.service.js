import { v4 as uuidv4 } from "uuid";

import logger from "../../logger.js";
import { processBillingEvents } from "./billingDebit.service.js";

// Background AI jobs (chatbot suggestions, gpt memory, agent-memory
// canonicalizer, sub-thread titles) run on OUR platform agents with
// GTWY_PAUTH_KEY, so the customer never pays for them through the normal path.
// They are not free to us, though: the response from api.gtwy.ai already carries
// the USD cost gtwy-ai computed, and callAiMiddlewareWithUsage now returns it.
// This turns that number into a wallet debit against the org whose request
// triggered the job.
//
// Pass-through pricing: same formula and same rate env var as Python's
// build_llm_usage_event, so a background charge is priced identically to a main
// call. Charge-after-the-fact by design — a job is never gated or blocked on
// balance, so an exhausted org can dip slightly negative rather than silently
// losing its memory and suggestions.

const CREDIT_RATE_USD = Number(process.env.LAGO_CREDIT_RATE_USD);
const CREDIT_QUANTUM = 10000; // 4 decimal places, matching Python's _CREDIT_QUANTUM

// GTWY's cut, added on top of the provider cost. 0 = bill at cost. Must equal
// gtwy-ai's GTWY_COMMISSION_PCT or background jobs are priced differently from
// main calls; billingPlans.assertBillingPlansConfigured logs the effective
// value at boot so a mismatch is visible.
const COMMISSION_PCT = Number(process.env.GTWY_COMMISSION_PCT ?? 0);
const COMMISSION_MULTIPLIER = 1 + (Number.isFinite(COMMISSION_PCT) ? COMMISSION_PCT : 0) / 100;

// Math.round is half-up for positive values, which is what Python's
// ROUND_HALF_UP does; costs are always positive so the two agree.
const round4 = (n) => Math.round(n * CREDIT_QUANTUM) / CREDIT_QUANTUM;

// A set-but-nonsensical value must not silently become "bill at cost" — that is
// a revenue leak nobody would notice. Unset IS a legitimate choice, so it
// defaults to 0. Logged at load so a mismatch with gtwy-ai is visible in both
// services' startup output.
if (process.env.GTWY_COMMISSION_PCT != null && String(process.env.GTWY_COMMISSION_PCT).trim() !== "") {
  if (!Number.isFinite(COMMISSION_PCT) || COMMISSION_PCT < 0 || COMMISSION_PCT > 100) {
    throw new Error(`GTWY_COMMISSION_PCT must be a number between 0 and 100 (got ${process.env.GTWY_COMMISSION_PCT})`);
  }
}
logger.info(
  `[billing] credit rate $${CREDIT_RATE_USD} per credit, GTWY commission ${COMMISSION_PCT}% ` +
    `(multiplier ${COMMISSION_MULTIPLIER}). gtwy-ai must match.`
);

// Two-step, in the same ORDER as Python's build_llm_usage_event: round the
// provider cost to credits first, then apply the commission to that rounded
// figure. Rounding once at the end instead would put the two services a
// fraction apart on the same inputs.
const toCredits = (cost_usd) => {
  const base = round4(cost_usd / CREDIT_RATE_USD);
  return { base: base.toFixed(4), charged: round4(base * COMMISSION_MULTIPLIER).toFixed(4) };
};

/**
 * Debit the triggering org for one background AI call. Never throws.
 *
 * @param {object}  args
 * @param {string}  args.job        which job ran, e.g. "chatbot_suggestions"
 * @param {object}  args.usage      the usage block from callAiMiddlewareWithUsage
 * @param {object}  args.billing    the `background_billing` block from the Python payload
 * @param {string} [args.bridge_id] the platform agent that ran, for Lago metadata
 */
async function debitBackgroundJob({ job, usage, billing, bridge_id }) {
  try {
    // No attribution block means Python deliberately sent none: the customer ran
    // on their own API key, so background work is on us. Nothing to bill.
    if (!billing?.org_id) return;

    const cost_usd = Number(usage?.cost);
    // Cache hits come back with cost 0 (ai_middleware_format.py) — genuinely free.
    if (!Number.isFinite(cost_usd) || cost_usd <= 0) return;

    if (!Number.isFinite(CREDIT_RATE_USD) || CREDIT_RATE_USD <= 0) {
      logger.error(`[billing] bg debit skipped for org=${billing.org_id} job=${job}: LAGO_CREDIT_RATE_USD is missing or invalid`);
      return;
    }

    const { base, charged: credits } = toCredits(cost_usd);
    if (Number(credits) <= 0) return;

    // `bgjob-` cannot collide with Python's `llm-usage-…` namespace. The job name
    // makes the charge self-describing in Lago, Redis and failed_billing_debits;
    // message_id ties it back to the customer-visible request.
    //
    // The uuid MUST be random, not derived. Python uses a nonce so an id is
    // STABLE across queue redeliveries (one event dict, many deliveries). Here
    // the opposite holds: a redelivery re-runs the job and spends real provider
    // money again, so a deterministic id would mark that second genuine charge a
    // duplicate and silently eat it.
    const transaction_id = `bgjob-${job}-${billing.message_id || "no-msg"}-${uuidv4()}`;

    await processBillingEvents([
      {
        type: "background_job_debit",
        job,
        transaction_id,
        org_id: billing.org_id,
        credits,
        // cost_usd stays the REAL provider cost — never fold the commission in,
        // metrics and spend alerts read it.
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
    // Billing must never break the job it is billing for. processBillingEvents
    // already swallows per-event failures, stores them in failed_billing_debits
    // and alerts; this is the last-resort net for anything above that.
    logger.error(`[billing] bg debit failed for job=${job} org=${billing?.org_id}: ${err.message}`);
  }
}

export { debitBackgroundJob };
