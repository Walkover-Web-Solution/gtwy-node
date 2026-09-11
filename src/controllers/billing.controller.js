import logger from "../logger.js";
import { isStripeConfigured } from "../configs/stripe.js";
import {
  BillingError,
  constructWebhookEvent,
  createCheckoutSession,
  createPortalSession,
  getSubscriptionView,
  processStripeEvent,
  reconcileStripeSubscriptions,
  replayStripeEvent
} from "../services/stripeBilling.service.js";
import orgBillingService from "../db_services/orgBilling.service.js";
import stripeEventService from "../db_services/stripeEvent.service.js";

// Customer-facing routes take the org from the token, never from the body —
// same rule as getWalletBalance in lago.controller.js. Embed tokens act on
// behalf of an end user, not the org, so they may not buy anything.
const resolveOrg = (req, res) => {
  if (!isStripeConfigured()) {
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

// BillingError carries its own status; a Stripe SDK error is a 502 with the
// detail logged, never echoed (it can contain account-level information).
const fail = (req, res, err, what) => {
  if (err instanceof BillingError) {
    req.statusCode = err.statusCode || 500;
    res.locals = { success: false, message: err.message };
    return;
  }
  if (String(err?.type || "").startsWith("Stripe")) {
    logger.error(`[stripe] ${what}: ${err.type} ${err.code ?? ""} ${err.message}`);
    req.statusCode = 502;
    res.locals = { success: false, message: "payment provider error, please try again" };
    return;
  }
  throw err;
};

// Start the $20/month Pro subscription. Returns the hosted Checkout URL.
const createCheckout = async (req, res, next) => {
  const org_id = resolveOrg(req, res);
  if (!org_id) return next();
  try {
    const email = req.profile?.user?.email || null;
    const result = await createCheckoutSession(org_id, { email, initiated_by: email || "" });
    res.locals = { success: true, message: result.reused ? "existing checkout session" : "checkout session created", data: result };
    req.statusCode = 200;
  } catch (err) {
    fail(req, res, err, "createCheckout");
  }
  return next();
};

// Stripe's hosted portal: update card, cancel at period end, download invoices.
const createPortal = async (req, res, next) => {
  const org_id = resolveOrg(req, res);
  if (!org_id) return next();
  try {
    res.locals = { success: true, data: await createPortalSession(org_id) };
    req.statusCode = 200;
  } catch (err) {
    fail(req, res, err, "createPortal");
  }
  return next();
};

// The caller's own plan (as Lago enforces it) and Stripe subscription mirror — for the UI banner.
const getSubscription = async (req, res, next) => {
  const org_id = resolveOrg(req, res);
  if (!org_id) return next();
  try {
    res.locals = { success: true, data: await getSubscriptionView(org_id) };
    req.statusCode = 200;
  } catch (err) {
    fail(req, res, err, "getSubscription");
  }
  return next();
};

// Stripe webhook. Responds DIRECTLY: it is mounted before express.json (raw
// body for the signature) and must never fall through to responseMiddleware.
// 400 = not from Stripe. 200 = processed, ignored, duplicate, or a permanent
// failure a human must look at. 500 = transient failure, Stripe will retry.
const stripeWebhook = async (req, res) => {
  if (!isStripeConfigured()) return res.status(503).json({ received: false, message: "billing disabled" });
  let event;
  try {
    event = constructWebhookEvent(req.body, req.get("stripe-signature"));
  } catch (err) {
    logger.warn(`[stripe] rejected webhook: ${err.message}`);
    return res.status(err instanceof BillingError ? err.statusCode : 400).json({ received: false });
  }
  const result = await processStripeEvent(event);
  return res.status(result.http).json({ received: true, status: result.status });
};

// --- admin (InternalAuth) -----------------------------------------------------

const getOrgBillingAdmin = async (req, res, next) => {
  const row = await orgBillingService.getByOrg(req.params.org_id);
  res.locals = row ? { success: true, data: row } : { success: false, message: `no billing record for org ${req.params.org_id}` };
  req.statusCode = row ? 200 : 404;
  return next();
};

const listOrgEvents = async (req, res, next) => {
  res.locals = { success: true, data: await stripeEventService.listByOrg(req.params.org_id) };
  req.statusCode = 200;
  return next();
};

const replayEvent = async (req, res, next) => {
  if (!isStripeConfigured()) {
    req.statusCode = 503;
    res.locals = { success: false, message: "billing is not enabled on this environment" };
    return next();
  }
  try {
    const result = await replayStripeEvent(req.params.event_id);
    res.locals = { success: result.http === 200, message: `replay ${result.status}`, data: result };
    req.statusCode = 200;
  } catch (err) {
    fail(req, res, err, "replayEvent");
  }
  return next();
};

const runReconcile = async (req, res, next) => {
  if (!isStripeConfigured()) {
    req.statusCode = 503;
    res.locals = { success: false, message: "billing is not enabled on this environment" };
    return next();
  }
  try {
    const summary = await reconcileStripeSubscriptions({ dryRun: req.body.dry_run !== false, lookbackDays: req.body.lookback_days });
    res.locals = { success: true, message: summary.dry_run ? "dry run — nothing changed" : "reconcile finished", data: summary };
    req.statusCode = 200;
  } catch (err) {
    fail(req, res, err, "runReconcile");
  }
  return next();
};

export default { createCheckout, createPortal, getSubscription, stripeWebhook, getOrgBillingAdmin, listOrgEvents, replayEvent, runReconcile };
