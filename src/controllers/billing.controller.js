import logger from "../logger.js";
import { isLagoBillingEnabled } from "../configs/lagoBilling.js";
import {
  BillingError,
  cancel,
  getPortal,
  getSubscriptionView,
  parseLagoEvent,
  processLagoEvent,
  reconcileBilling,
  replayEvent,
  resume,
  retryOpenInvoice,
  startCheckout,
  subscribe,
  verifyLagoSignature
} from "../services/lagoBilling.service.js";
import orgBillingService from "../db_services/orgBilling.service.js";
import billingEventService from "../db_services/billingEvent.service.js";

// Customer-facing routes take the org from the token, never from the body —
// same rule as getWalletBalance in lago.controller.js. Embed tokens act on
// behalf of an end user, not the org, so they may not buy anything.
const resolveOrg = (req, res) => {
  if (!isLagoBillingEnabled()) {
    req.statusCode = 503;
    res.locals = { success: false, message: "billing is not enabled on this environment" };
    return null;
  }
  const org_id = req.profile?.org?.id;
  if (!org_id) {
    req.statusCode = 403;
    res.locals = { success: false, message: "org not resolved from token" };
    return null;
  }
  if (req.IsEmbedUser) {
    req.statusCode = 403;
    res.locals = { success: false, message: "embed users cannot manage billing" };
    return null;
  }
  return String(org_id);
};

// BillingError carries its own status; a Lago API error is a 502 with the
// detail logged, never echoed (it can carry account-level information).
const fail = (req, res, err, what) => {
  if (err instanceof BillingError) {
    req.statusCode = err.statusCode || 500;
    res.locals = { success: false, message: err.message };
    return;
  }
  if (err?.lagoStatus) {
    logger.error(`[billing] ${what}: Lago ${err.lagoStatus} ${err.message}`);
    req.statusCode = 502;
    res.locals = { success: false, message: "billing provider error, please try again" };
    return;
  }
  throw err;
};

const actorOf = (req) => req.profile?.user?.email || "";

// Run a customer action and shape the response.
const customerAction = (what, run) => async (req, res, next) => {
  const org_id = resolveOrg(req, res);
  if (!org_id) return next();
  try {
    const { message, data } = await run(org_id, req);
    res.locals = { success: true, ...(message ? { message } : {}), data };
    req.statusCode = 200;
  } catch (err) {
    fail(req, res, err, what);
  }
  return next();
};

// Save a card (Stripe Checkout in setup mode, hosted by Lago). Also changes the card.
const createCheckout = customerAction("createCheckout", async (org_id, req) => ({
  message: "checkout session created",
  data: await startCheckout(org_id, { email: req.profile?.user?.email || null, initiated_by: actorOf(req) })
}));

// Card saved: move the org to Pro. Lago bills $20 now; the webhook settles credits.
const subscribeToPro = customerAction("subscribe", async (org_id, req) => ({
  message: "subscription started; first payment in progress",
  data: await subscribe(org_id, { actor: actorOf(req) })
}));

const cancelSubscription = customerAction("cancel", async (org_id, req) => {
  const result = await cancel(org_id, { actor: actorOf(req) });
  return { message: result.deferred ? "subscription will end at the close of the current period" : "subscription ended", data: result };
});

const resumeSubscription = customerAction("resume", async (org_id, req) => ({
  message: "cancellation withdrawn",
  data: await resume(org_id, { actor: actorOf(req) })
}));

const retryPayment = customerAction("retry", async (org_id) => ({ message: "payment retry requested", data: await retryOpenInvoice(org_id) }));

// Lago's hosted portal: invoices, usage, credits.
const createPortal = customerAction("createPortal", async (org_id) => ({ data: await getPortal(org_id) }));

// The caller's own plan (as Lago enforces it) and billing state — for the UI banner.
const getSubscription = customerAction("getSubscription", async (org_id) => ({ data: await getSubscriptionView(org_id) }));

// Lago webhook. Responds DIRECTLY: it is mounted before express.json (raw body
// for the signature) and must never fall through to responseMiddleware.
// 400 = not from Lago. 200 = processed, ignored, duplicate, or a permanent
// failure a human must look at. 500 = transient failure, Lago retries.
const lagoWebhook = async (req, res) => {
  if (!isLagoBillingEnabled()) return res.status(503).json({ received: false, message: "billing disabled" });
  let event;
  try {
    verifyLagoSignature(req.body, req.headers);
    const body = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? ""));
    event = { ...parseLagoEvent(body), unique_key: req.get("x-lago-unique-key") || null };
  } catch (err) {
    logger.warn(`[billing] rejected webhook: ${err.message}`);
    return res.status(err instanceof BillingError ? err.statusCode : 400).json({ received: false });
  }
  if (!event.unique_key) {
    logger.warn(`[billing] webhook ${event.webhook_type} without X-Lago-Unique-Key; rejected`);
    return res.status(400).json({ received: false, message: "missing X-Lago-Unique-Key" });
  }
  const result = await processLagoEvent(event);
  return res.status(result.http).json({ received: true, status: result.status });
};

// --- admin (InternalAuth) -----------------------------------------------------

const requireEnabled = (req, res) => {
  if (isLagoBillingEnabled()) return true;
  req.statusCode = 503;
  res.locals = { success: false, message: "billing is not enabled on this environment" };
  return false;
};

const getOrgBillingAdmin = async (req, res, next) => {
  const row = await orgBillingService.getByOrg(req.params.org_id);
  res.locals = row ? { success: true, data: row } : { success: false, message: `no billing record for org ${req.params.org_id}` };
  req.statusCode = row ? 200 : 404;
  return next();
};

const listOrgEvents = async (req, res, next) => {
  res.locals = { success: true, data: await billingEventService.listByOrg(req.params.org_id) };
  req.statusCode = 200;
  return next();
};

const replayBillingEvent = async (req, res, next) => {
  if (!requireEnabled(req, res)) return next();
  try {
    const result = await replayEvent(req.params.unique_key);
    res.locals = { success: result.http === 200, message: `replay ${result.status}`, data: result };
    req.statusCode = 200;
  } catch (err) {
    fail(req, res, err, "replayEvent");
  }
  return next();
};

const runReconcile = async (req, res, next) => {
  if (!requireEnabled(req, res)) return next();
  try {
    const summary = await reconcileBilling({ dryRun: req.body.dry_run !== false, lookbackDays: req.body.lookback_days });
    res.locals = { success: true, message: summary.dry_run ? "dry run — nothing changed" : "reconcile finished", data: summary };
    req.statusCode = 200;
  } catch (err) {
    fail(req, res, err, "runReconcile");
  }
  return next();
};

export default {
  createCheckout,
  subscribeToPro,
  cancelSubscription,
  resumeSubscription,
  retryPayment,
  createPortal,
  getSubscription,
  lagoWebhook,
  getOrgBillingAdmin,
  listOrgEvents,
  replayBillingEvent,
  runReconcile
};
