import cron from "node-cron";
import logger from "../logger.js";
import client from "../services/cache.service.js";
import { isStripeConfigured } from "../configs/stripe.js";
import { RECONCILE_LOCK_KEY, acquireLock, releaseLock, reconcileStripeSubscriptions } from "../services/stripeBilling.service.js";
import { unknown_error_handler_alert } from "../services/utils/utility.service.js";

// Nightly, 03:15 UTC. Credits any paid Stripe invoice we never processed,
// fixes Stripe-vs-Lago plan drift, replays retryable failed events. Every
// replica runs every cron (no leader election), so the Redis lock makes sure
// exactly one does the work; the rest return immediately.
const initializeStripeReconcile = () => {
  return cron.schedule("15 3 * * *", async () => {
    if (!isStripeConfigured()) return;
    if (!client.isReady) {
      unknown_error_handler_alert("stripeReconcileSkipped", null, "redis unavailable — reconcile did not run");
      return;
    }
    if (!(await acquireLock(RECONCILE_LOCK_KEY, 3600))) return;
    try {
      await reconcileStripeSubscriptions({ dryRun: false });
    } catch (err) {
      logger.error(`[stripe] reconcile failed: ${err.message}`);
      unknown_error_handler_alert("stripeReconcileFailed", null, err.message);
    } finally {
      await releaseLock(RECONCILE_LOCK_KEY);
    }
  });
};

export default initializeStripeReconcile;
