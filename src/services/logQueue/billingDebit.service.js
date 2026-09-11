import logger from "../../logger.js";
import client from "../cache.service.js";
import { REDIS_PREFIX } from "../../cache_service/index.js";
import FailedBillingDebitModel from "../../mongoModel/FailedBillingDebit.model.js";
import { walletDebit, isWalletNotFoundError } from "../lago.service.js";
import { unknown_error_handler_alert } from "../utils/utility.service.js";
import { redis_keys } from "../../configs/constant.js";
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;
const PLATFORM_ORG_ID = process.env.GTWY_PLATFORM_ORG_ID;

const DISPATCHED_TTL = 86400;

const APPLIED_TTL = 86400;

// Claim the transaction and decrement the shadow balance in one atomic step.
// KEYS[1]=claim  KEYS[2]=balance  ARGV[1]=credits  ARGV[2]=claim ttl
const DEBIT_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 0 then
  return 'MISSING'
end
local claimed = redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[2])
if not claimed then
  return 'DUPLICATE'
end
redis.call('INCRBYFLOAT', KEYS[2], -tonumber(ARGV[1]))
return 'OK'
`;

// The {org_id} hash tag keeps both keys in one Redis Cluster slot, as the script requires.
const balanceKey = (org_id) => `${REDIS_PREFIX}${redis_keys.billing_credit_balance_}{${org_id}}`;
const appliedKey = (org_id, transaction_id) => `${REDIS_PREFIX}${redis_keys.billing_credit_applied_}{${org_id}}_${transaction_id}`;

// Mirror a charge Lago accepted into the gate's shadow balance. Never throws.
const applyShadowDebit = async (org_id, credits, transaction_id) => {
  if (!client.isReady) {
    logger.warn(`[billing] shadow debit skipped for org=${org_id} tx=${transaction_id}: redis unavailable`);
    return;
  }
  try {
    // credits stays a string so the 4dp decimal never takes a JS float round-trip.
    // DUPLICATE (already applied) and MISSING (no balance key yet — the next
    // request seeds it from Lago) both need nothing more from us.
    await client.eval(DEBIT_SCRIPT, {
      keys: [appliedKey(org_id, transaction_id), balanceKey(org_id)],
      arguments: [String(credits), String(APPLIED_TTL)]
    });
  } catch (err) {
    logger.error(`[billing] shadow debit failed for org=${org_id} tx=${transaction_id}: ${err.message}`);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const dispatchKey = (transaction_id) => `${REDIS_PREFIX}${redis_keys.billing_lago_dispatched_}${transaction_id}`;

// Claim a transaction_id so a queue redelivery cannot double-charge.
const claimTransaction = async (transaction_id) => {
  if (!client.isReady) return true; // fail open: no dedup without Redis, but billing continues
  const claimed = await client.set(dispatchKey(transaction_id), "1", { NX: true, EX: DISPATCHED_TTL });
  return claimed !== null;
};

// Persist a charge Lago did not take, so it can be replayed instead of vanishing.
const storeFailedDebit = async (event, error, status) => {
  try {
    await FailedBillingDebitModel.updateOne(
      { transaction_id: event.transaction_id },
      {
        $setOnInsert: { org_id: String(event.org_id), event, status },
        $set: { error: String(error?.message ?? error).slice(0, 2000) },
        $inc: { attempts: 1 }
      },
      { upsert: true }
    );
  } catch (storeErr) {
    logger.error(`[billing] could not store failed debit ${event.transaction_id}: ${storeErr.message}`);
  }
};

// Post one charge to Lago, then mirror it into the shadow balance.
const postDebit = async (event) => {
  const { org_id, credits, transaction_id, message_id } = event;
  await walletDebit(org_id, credits, transaction_id, {
    message_id,
    model: event.model,
    service: event.service,
    bridge_id: event.bridge_id,
    user_id: event.user_id,
    folder_id: event.folder_id,
    thread_id: event.thread_id,
    is_embed: event.is_embed,
    job: event.job,
    // What the charge is made of, so it can be explained after the fact.
    base_credits: event.base_credits,
    commission_pct: event.commission_pct
  });
  // Lago first, shadow second and only on success — a rejected charge must not move the gate.
  await applyShadowDebit(org_id, credits, transaction_id);
};

// Charge one usage event, retrying while the subscription is still being provisioned.
async function debitOne(event) {
  const { org_id, credits, transaction_id } = event || {};

  // Internal traffic must never be billed to the platform org.
  if (PLATFORM_ORG_ID && String(org_id) === String(PLATFORM_ORG_ID)) {
    logger.error(
      `[billing] REFUSING debit against the platform org (${org_id}) transaction_id=${transaction_id} — ` +
        `GTWY_PLATFORM_ORG_ID suppression in gtwy-ai's reserve_credits_and_api_key_setup is not working`
    );
    return;
  }

  if (!org_id || !credits || !transaction_id) {
    logger.error(`[billing] dropping malformed llm_usage_debit event: ${JSON.stringify(event)}`);
    unknown_error_handler_alert("billingDebitMalformedEvent", null, JSON.stringify(event));
    return;
  }

  if (!(await claimTransaction(transaction_id))) {
    logger.warn(`[billing] skipping duplicate llm_usage_debit transaction_id=${transaction_id} (already dispatched to Lago)`);
    return;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await postDebit(event);
      return;
    } catch (err) {
      const retryable = isWalletNotFoundError(err);
      if (retryable && attempt < MAX_ATTEMPTS) {
        logger.warn(`[billing] subscription not found yet for org_id=${org_id} (attempt ${attempt}/${MAX_ATTEMPTS}), retrying: ${err.message}`);
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      // An error from Lago means the event was not ingested and is safe to replay;
      // no answer at all is ambiguous and is left for manual review.
      const lagoAnswered = Boolean(err?.response ?? err?.lagoStatus);
      await storeFailedDebit(event, err, lagoAnswered ? "failed" : "ambiguous");
      logger.error(`[billing] wallet debit failed for org_id=${org_id} transaction_id=${transaction_id}: ${err.message}`);
      unknown_error_handler_alert("billingDebitFailed", null, `org_id=${org_id} transaction_id=${transaction_id} error=${err.message}`);
      return;
    }
  }
}
// Charge every usage event in one queue message.
async function processBillingEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return;
  await Promise.all(events.map(debitOne));
}

// Re-post stored "failed" debits; "ambiguous" rows are left for manual review.
async function replayFailedDebits(limit = 100) {
  const rows = await FailedBillingDebitModel.find({ status: "failed" })
    .sort({ created_at: 1 })
    .limit(Math.min(Number(limit) || 100, 500));

  const result = { replayed: 0, failed: 0, skipped_ambiguous: 0 };
  for (const row of rows) {
    try {
      await postDebit(row.event);
      row.status = "replayed";
      row.replayed_at = new Date();
      await row.save();
      result.replayed += 1;
    } catch (err) {
      row.attempts += 1;
      row.error = String(err?.message ?? err).slice(0, 2000);
      await row.save();
      result.failed += 1;
    }
  }
  return result;
}

export { processBillingEvents, replayFailedDebits };
