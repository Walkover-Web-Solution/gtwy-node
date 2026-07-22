import logger from "../../logger.js";
import { walletDebit, isWalletNotFoundError } from "../lago.service.js";
import { unknown_error_handler_alert } from "../utils/utility.service.js";

// Consumes the `billing` array Python attaches to the same sub-queue message
// that already carries conversation history (docs/billing-idempotency-outbox-
// credit-system.md §2-§4). One event per completed LLM call — per hop for a
// transfer chain. `credits` and `transaction_id` are frozen on the Python side
// (§9.1) and MUST be forwarded verbatim, never recomputed here.
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function debitOne(event) {
  const { org_id, credits, transaction_id, message_id } = event || {};
  if (!org_id || !credits || !transaction_id) {
    logger.error(`[billing] dropping malformed llm_usage_debit event: ${JSON.stringify(event)}`);
    unknown_error_handler_alert("billingDebitMalformedEvent", null, JSON.stringify(event));
    return;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await walletDebit(org_id, credits, transaction_id, {
        message_id,
        model: event.model,
        service: event.service,
        bridge_id: event.bridge_id
      });
      return;
    } catch (err) {
      // Residual new-org wallet race (§9.4): the wallet is provisioned at
      // org-creation time and should appear shortly — retry a few times rather
      // than dropping a legitimate debit.
      const retryable = isWalletNotFoundError(err);
      if (retryable && attempt < MAX_ATTEMPTS) {
        logger.warn(`[billing] wallet not found yet for org_id=${org_id} (attempt ${attempt}/${MAX_ATTEMPTS}), retrying: ${err.message}`);
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }

      // Exhausted retries or a non-retryable failure. This must never throw
      // back into the log-queue message handler — a billing failure cannot be
      // allowed to block or duplicate the conversation-history save that rides
      // in the same message. Page a human instead (doc §7.2: "dead-letter =
      // free usage, forever" — silence here is the exact gap that creates).
      logger.error(`[billing] wallet debit failed permanently for org_id=${org_id} transaction_id=${transaction_id}: ${err.message}`);
      unknown_error_handler_alert("billingDebitFailed", null, `org_id=${org_id} transaction_id=${transaction_id} error=${err.message}`);
      return;
    }
  }
}

async function processBillingEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return;
  await Promise.all(events.map(debitOne));
}

export { processBillingEvents };
