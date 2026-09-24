import cron from "node-cron";
import logger from "../logger.js";
import client from "../services/cache.service.js";
import { isLagoBillingEnabled } from "../configs/lagoBilling.js";
import { RECONCILE_LOCK_KEY, acquireLock, releaseLock, reconcileBilling } from "../services/lagoBilling.service.js";
import { unknown_error_handler_alert } from "../services/utils/utility.service.js";

// Nightly, 03:15 UTC. Credits any paid subscription invoice we never processed,
// retries the open invoice of every org in grace, downgrades orgs whose grace
// ran out, fixes Lago-vs-Redis plan drift, replays retryable failed events.
// Every replica runs every cron (no leader election), so the Redis lock makes
// sure exactly one does the work; the rest return immediately.
const initializeReconcileBilling = () => {
  return cron.schedule("15 3 * * *", async () => {
    if (!isLagoBillingEnabled()) return;
    if (!client.isReady) {
      unknown_error_handler_alert("lagoReconcileSkipped", null, "redis unavailable — billing reconcile did not run");
      return;
    }
    if (!(await acquireLock(RECONCILE_LOCK_KEY, 3600))) return;
    try {
      await reconcileBilling({ dryRun: false });
    } catch (err) {
      logger.error(`[billing] reconcile failed: ${err.message}`);
      unknown_error_handler_alert("lagoReconcileFailed", null, err.message);
    } finally {
      await releaseLock(RECONCILE_LOCK_KEY);
    }
  });
};

export default initializeReconcileBilling;
