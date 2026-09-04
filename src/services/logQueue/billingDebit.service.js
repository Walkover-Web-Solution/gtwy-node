import logger from "../../logger.js";
import client from "../cache.service.js";
import FailedBillingDebitModel from "../../mongoModel/FailedBillingDebit.model.js";
import { walletDebit, isWalletNotFoundError } from "../lago.service.js";
import { unknown_error_handler_alert } from "../utils/utility.service.js";
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;
const PLATFORM_ORG_ID = process.env.GTWY_PLATFORM_ORG_ID;

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

// Python owns the Redis shadow balance that the request admission gate reads,
// and seeds it with NX and NO TTL (billing_utils.py _sync_balance_from_lago), so
// nothing ever refreshes it while it exists and there is no reconciliation cron.
// For MAIN calls Python decrements it itself. For BACKGROUND-JOB charges (billed
// here, never seen by Python) nobody would — and the shadow would drift above
// Lago permanently and monotonically, so with reserve_overdraft_floor = -100 the
// gate would over-admit forever.
//
// We claim PYTHON'S OWN key, which makes this self-guarding with no branch:
// - main-call events: Python already claimed it, the script returns DUPLICATE, no-op
// - background-job events: only we ever see them, so the decrement lands
// It also recovers main-call decrements Python lost when its Redis write threw
// (billing_utils.apply_debit swallows).
const BALANCE_KEY = "nd_billing_credit_balance_";
const APPLIED_KEY = "nd_billing_credit_applied_";
const APPLIED_TTL = 86400;

// Byte-for-byte Python's _DEBIT_SCRIPT (billing_utils.py), with ONE deliberate
// difference at the call site below: on MISSING we give up instead of seeding.
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

// The {org_id} hash tag is MANDATORY: the script touches the claim key and the
// balance key together, so both must hash to one Redis Cluster slot. Brace
// placement mirrors Python's _key()/_hold_key() exactly.
const balanceKey = (org_id) => `${REDIS_PREFIX}${BALANCE_KEY}{${org_id}}`;
const appliedKey = (org_id, transaction_id) => `${REDIS_PREFIX}${APPLIED_KEY}{${org_id}}_${transaction_id}`;

// Mirror a charge Lago accepted into the gate's shadow balance. Never throws:
// the money already moved, and the shadow is only a cache in front of the gate.
const applyShadowDebit = async (org_id, credits, transaction_id) => {
  if (!client.isReady) {
    logger.warn(`[billing] shadow debit skipped for org=${org_id} tx=${transaction_id}: redis unavailable`);
    return;
  }
  try {
    // credits stays a STRING — it is a 4dp decimal Python produced, and Lua's
    // tonumber reads it directly without a JS float round-trip.
    const status = await client.eval(DEBIT_SCRIPT, {
      keys: [appliedKey(org_id, transaction_id), balanceKey(org_id)],
      arguments: [String(credits), String(APPLIED_TTL)]
    });
    // MISSING: no balance key, so nothing to decrement — and deliberately NOT
    // seeded here. Python's seed path reads credits_ongoing_balance, which
    // already includes rated-but-uninvoiced usage, so seeding then decrementing
    // would double-count. An absent key needs no action: the next customer
    // request seeds it NX from a Lago figure that already reflects this event.
    if (status === "DUPLICATE" || status === "MISSING") return;
  } catch (err) {
    logger.error(`[billing] shadow debit failed for org=${org_id} tx=${transaction_id}: ${err.message}`);
  }
};

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
    folder_id: event.folder_id,
    // thread_id and is_embed are sent by Python and used to be dropped here;
    // job distinguishes a background-AI charge from a main completion.
    thread_id: event.thread_id,
    is_embed: event.is_embed,
    job: event.job
  });
  // Lago FIRST, shadow SECOND, and only on success: decrementing the gate's
  // balance for a charge Lago rejected would block the customer's next request
  // for revenue we never booked, then double-decrement when the replay lands.
  // Lives here rather than in debitOne because replayFailedDebits calls
  // postDebit directly — anything added to debitOne is skipped on replay.
  await applyShadowDebit(org_id, credits, transaction_id);
};

async function debitOne(event) {
  const { org_id, credits, transaction_id } = event || {};

  // Second line of defence behind gtwy-ai's platform-org suppression: internal
  // traffic (our background jobs calling our own agents) must never be billed to
  // the platform org. If one of these shows up, the Python guard was bypassed.
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
