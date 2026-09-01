import logger from "../../logger.js";
import client from "../cache.service.js";
import FailedBillingDebitModel from "../../mongoModel/FailedBillingDebit.model.js";
import { walletDebit, isWalletNotFoundError } from "../lago.service.js";
import { unknown_error_handler_alert } from "../utils/utility.service.js";
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

// Lago's async event ingestion does NOT enforce transaction_id uniqueness
// (verified live: the same transaction_id posted twice was counted twice), so a
// RabbitMQ redelivery of a log-queue message would double-charge the customer.
// Claim each transaction_id in Redis before posting — same pattern as
// claimTopupReference in lago.service.js. Deliberately a DIFFERENT key prefix
// than Python's nd_billing_credit_applied_ (that one guards the Redis shadow
// balance and is already claimed by the Python process before this consumer runs).
const REDIS_PREFIX = `AIMIDDLEWARE_${process.env.ENVIRONMENT}_`;
const DISPATCHED_KEY = "nd_billing_lago_dispatched_";
const DISPATCHED_TTL = 86400;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const dispatchKey = (transaction_id) => `${REDIS_PREFIX}${DISPATCHED_KEY}${transaction_id}`;

const claimTransaction = async (transaction_id) => {
  if (!client.isReady) return true; // fail open: no dedup without Redis, but billing continues
  const claimed = await client.set(dispatchKey(transaction_id), "1", { NX: true, EX: DISPATCHED_TTL });
  return claimed !== null;
};

// The consumer acks the queue message before we know Lago's answer, so a
// failed debit has nowhere to be retried from — "release the claim and let a
// redelivery handle it" was a fiction (the nack path is requeue=false). A
// charge that fails is STORED and re-posted via POST /api/lago/debits/replay.
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

const postDebit = async (event) => {
  const { org_id, credits, transaction_id, message_id } = event;
  await walletDebit(org_id, credits, transaction_id, {
    message_id,
    model: event.model,
    service: event.service,
    bridge_id: event.bridge_id,
    user_id: event.user_id,
    folder_id: event.folder_id
  });
};

async function debitOne(event) {
  const { org_id, credits, transaction_id } = event || {};
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
      // Lago answered with an error → the event was definitely not ingested:
      // store as "failed" (safe to replay). No answer at all (timeout/network)
      // is ambiguous — the event may have landed and Lago won't dedup a
      // resend, so store as "ambiguous" for manual review: under-charging
      // beats double-charging. Either way the charge is persisted, alerted,
      // and replayable — never silently dropped.
      const lagoAnswered = Boolean(err?.response ?? err?.lagoStatus);
      await storeFailedDebit(event, err, lagoAnswered ? "failed" : "ambiguous");
      logger.error(`[billing] wallet debit failed for org_id=${org_id} transaction_id=${transaction_id}: ${err.message}`);
      unknown_error_handler_alert("billingDebitFailed", null, `org_id=${org_id} transaction_id=${transaction_id} error=${err.message}`);
      return;
    }
  }
}
async function processBillingEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return;
  await Promise.all(events.map(debitOne));
}

// Re-post stored "failed" debits (Lago rejected them, so a resend cannot
// double-charge). "ambiguous" rows are left for manual review.
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
