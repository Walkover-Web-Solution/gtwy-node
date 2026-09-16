import crypto from "crypto";
import logger from "../logger.js";
import client from "./cache.service.js";
import { REDIS_PREFIX } from "../cache_service/index.js";
import { redis_keys } from "../configs/constant.js";
import { planCodeFor } from "../configs/billingPlans.js";
import { graceDays, webhookHmacKeys } from "../configs/lagoBilling.js";
import {
  changeOrgPlan,
  ensureOrgSubscribed,
  ensureWalletPaysChargesOnly,
  getCheckoutUrl,
  getInvoice,
  getOrgPlanSlug,
  getPortalUrl,
  getSubscription,
  getWallet,
  incrementRedisBalance,
  invalidatePlanCache,
  listInvoices,
  listSubscriptionsByPlan,
  reconcileOrgPlan,
  retryInvoicePayment,
  setCustomerPaymentProvider,
  voidInvoice,
  walletCredit
} from "./lago.service.js";
import billingPlanService from "../db_services/billingPlan.service.js";
import orgBillingService from "../db_services/orgBilling.service.js";
import billingEventService from "../db_services/billingEvent.service.js";
import { unknown_error_handler_alert } from "./utils/utility.service.js";

// The $20/month Pro subscription, sold THROUGH Lago's Stripe connection.
//
// Lago owns the Stripe customer, the saved card, the monthly invoice and the
// charge. We (1) attach an org's Lago customer to the Stripe connection and hand
// out Lago's hosted pages, (2) move the org onto the `paid` Lago plan when the
// user asks — Lago bills it at once — and (3) react to Lago's webhooks: a PAID
// subscription invoice tops the wallet up to monthly_credits; a FAILED one
// starts a grace period (Lago does not retry payments for us) or, for a first
// payment, drops the org straight back to free.
//
// Lago retries a failed webhook delivery only a few times within seconds, so
// durability comes from the billing_events ledger plus the nightly reconcile,
// not from Lago's retries.

// ---------------------------------------------------------------- errors

// Two failure classes, two HTTP answers to Lago. Transient (Lago/Mongo/Redis
// unreachable, plan-change lock held, plan doc not configured) -> 500 so Lago
// retries and the reconcile replays. Permanent (unknown org, unresolvable plan)
// -> 200 + alert, so a human fixes the data and replays via the admin route.
export class BillingError extends Error {
  constructor(message, { permanent = false, statusCode = 500 } = {}) {
    super(message);
    this.name = "BillingError";
    this.permanent = permanent;
    this.statusCode = statusCode;
  }
}

const PAID_SLUG = "paid";
const FREE_SLUG = "free";

// Webhooks that carry no decision for us; recorded so the ledger shows them.
const RECORD_ONLY_EVENTS = new Set(["customer.checkout_url_generated", "invoice.created", "wallet_transaction.created"]);

const alert = (type, reason) => {
  try {
    unknown_error_handler_alert(type, null, reason);
  } catch {
    // alerting must never break billing
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hoursAgo = (date, hours) => date && Date.now() - new Date(date).getTime() < hours * 3600_000;
const plusDays = (days) => new Date(Date.now() + days * 86400_000);
const toDate = (value) => (value ? new Date(value) : null);

// ------------------------------------------------------------ pure helpers

// How many credits to add so the wallet lands on `target`. Never negative:
// an org already above the target gets nothing added and nothing taken. A
// negative balance (the -100 overdraft floor) yields target + |balance|, which
// is exactly "reset to target". Returns a decimal string (Lago takes strings).
export const computeTopupDelta = (spendable, target) => {
  const current = Number(spendable);
  const goal = Number(target);
  if (!Number.isFinite(current)) throw new BillingError(`wallet balance is not numeric: ${spendable}`);
  if (!Number.isFinite(goal) || goal <= 0) throw new BillingError(`invalid monthly_credits target: ${target}`);
  const delta = goal - current;
  if (delta <= 0) return "0";
  return String(Number(delta.toFixed(4)));
};

// What the org can spend right now: settled balance minus usage not yet
// invoiced. NOT Lago's credits_ongoing_balance — that figure is refreshed by an
// asynchronous job and reads 0.0 on a wallet created seconds ago while
// credits_balance already holds the signup grant, which would top a new Pro
// org up to 8,000 + grant instead of 8,000. Falls back to ongoing when the
// settled figure is missing.
export const spendableCredits = (wallet) => {
  const balance = Number(wallet?.credits_balance);
  if (Number.isFinite(balance)) return balance - (Number(wallet?.credits_ongoing_usage_balance) || 0);
  return Number(wallet?.credits_ongoing_balance);
};

// Does this Lago invoice bill the paid plan's subscription fee? Lago attaches
// the plan code to the subscription fee's item; a $0 invoice for the free plan
// (or a comped org) must never top a wallet up. When Lago gives no fee detail,
// a positive total is the best available signal.
export const invoiceIsForPaidPlan = (invoice, paidPlanCode) => {
  if (invoice?.invoice_type !== "subscription") return false;
  const fees = Array.isArray(invoice?.fees) ? invoice.fees : null;
  if (fees && fees.length) {
    return fees.some((fee) => fee?.item?.type === "subscription" && fee?.item?.code === paidPlanCode);
  }
  return Number(invoice?.total_amount_cents) > 0;
};

// Lago puts the payload under a key named after object_type. Accept both the
// documented shape and a flat one.
export const parseLagoEvent = (body) => {
  const webhook_type = body?.webhook_type ?? "";
  const object_type = body?.object_type ?? null;
  const object = (object_type && body?.[object_type]) ?? body?.object ?? {};
  return { webhook_type, object_type, object };
};

// ---------------------------------------------------------------- config

// monthly_credits lives on the `paid` billing_plans document (editable via PUT
// /api/billing-plans). Missing is a TRANSIENT failure on purpose: fixing the
// document makes the next retry succeed, and we never credit 0 or a guess.
export const getPaidPlanConfig = async () => {
  const plan = await billingPlanService.getPlan(PAID_SLUG);
  if (!plan) throw new BillingError(`billing_plans has no '${PAID_SLUG}' document`);
  const monthly_credits = Number(plan.monthly_credits);
  if (!Number.isFinite(monthly_credits) || monthly_credits <= 0) {
    throw new BillingError(`billing_plans.${PAID_SLUG}.monthly_credits is not a positive number (${plan.monthly_credits})`);
  }
  return { monthly_credits, display_name: plan.display_name, plan_code: planCodeFor(PAID_SLUG) };
};

// ----------------------------------------------------------------- locks

const lockKey = (name) => `${REDIS_PREFIX}${name}`;

// SET NX EX. Redis down => acquired (fail open), same policy as claimPlanChange.
export const acquireLock = async (key, ttlSeconds) => {
  if (!client.isReady) return true;
  const ok = await client.set(lockKey(key), "1", { NX: true, EX: ttlSeconds }).catch(() => null);
  return ok !== null;
};

export const releaseLock = async (key) => {
  if (!client.isReady) return;
  await client.del(lockKey(key)).catch(() => {});
};

// ------------------------------------------------------------ mirroring

// Refresh the subscription half of the org row from Lago (never from a payload).
const mirrorSubscription = async (org_id, extra = {}) => {
  const sub = await getSubscription(org_id).catch(() => null);
  const fields = {
    subscription_external_id: sub?.pending_only ? null : (sub?.external_id ?? null),
    current_period_start: toDate(sub?.current_period_start),
    current_period_end: toDate(sub?.current_period_end),
    ...extra
  };
  return { row: await orgBillingService.upsert(org_id, fields), subscription: sub };
};

const noteSelfChange = (actor) => ({ last_plan_change_by: actor, last_plan_change_at: new Date() });

// -------------------------------------------------------------- customer

// Step 1 of buying Pro: make sure the org's Lago customer is attached to the
// Stripe connection, then hand back Lago's setup-mode Checkout URL where the
// user saves a card. Nothing is charged here. Also the way to CHANGE a card.
export const startCheckout = async (org_id, { email = null, initiated_by = "" } = {}) => {
  const lock = `${redis_keys.billing_checkout_lock_}${org_id}`;
  if (!(await acquireLock(lock, 15))) {
    throw new BillingError("a checkout for this org is already being created", { permanent: true, statusCode: 409 });
  }
  try {
    const row = await orgBillingService.getByOrg(org_id);
    if (row?.status === "pending_first_payment") {
      throw new BillingError("the first payment for this org is still being processed", { permanent: true, statusCode: 409 });
    }
    // Fails loudly if monthly_credits is not configured — better now than at the first invoice.
    await getPaidPlanConfig();
    await ensureOrgSubscribed(org_id);
    // The wallet must never pay the subscription fee; fix older wallets here,
    // before any invoice can exist.
    await ensureWalletPaysChargesOnly(org_id);
    const customer = await setCustomerPaymentProvider(org_id, { email });
    const url = await getCheckoutUrl(org_id);
    if (!url) throw new BillingError("Lago returned no checkout URL", { statusCode: 502 });

    const keepStatus = row?.status === "active" || row?.status === "past_due";
    await orgBillingService.upsert(org_id, {
      ...(keepStatus ? {} : { status: "awaiting_card" }),
      lago_customer_id: customer?.lago_id ?? row?.lago_customer_id ?? null,
      stripe_customer_id: customer?.billing_configuration?.provider_customer_id ?? row?.stripe_customer_id ?? null,
      payment_provider_code: customer?.billing_configuration?.payment_provider_code ?? process.env.LAGO_STRIPE_PROVIDER_CODE ?? null,
      initiated_by: initiated_by || row?.initiated_by || ""
    });
    return { url };
  } finally {
    await releaseLock(lock);
  }
};

// Step 2: the card is saved (the frontend is back from Stripe). Move the org
// onto `paid`; Lago invoices the $20 immediately and charges the card. The
// outcome arrives as a webhook: succeeded -> credits + active, failed -> free.
//
// Terminate-and-recreate rather than rotate-in-place: a rotation inherits the
// free subscription's calendar billing and Lago prorates the first invoice to
// month end ($10.67 on the 15th). A fresh subscription on anniversary billing
// charges the flat $20 today and renews on this day each month, which is what
// the product promises and what the credit reset is aligned to.
export const subscribe = async (org_id, { actor = "" } = {}) => {
  const [row, current] = await Promise.all([orgBillingService.getByOrg(org_id), getSubscription(org_id)]);
  if (!row?.payment_provider_code) {
    throw new BillingError("start a checkout and save a card before subscribing", { permanent: true, statusCode: 409 });
  }
  if (row.status === "pending_first_payment") {
    throw new BillingError("the first payment for this org is still being processed", { permanent: true, statusCode: 409 });
  }
  if (current?.plan_slug === PAID_SLUG) {
    if (current.pending && current.pending.plan_slug !== PAID_SLUG) {
      throw new BillingError("this org is cancelling at period end; use resume instead", { permanent: true, statusCode: 409 });
    }
    throw new BillingError("this org is already on the paid plan", { permanent: true, statusCode: 409 });
  }
  await getPaidPlanConfig();

  await changeOrgPlan(org_id, PAID_SLUG, {
    actor: actor || "stripe-subscribe",
    reason: "customer subscribed via Stripe checkout",
    immediate: true,
    billingTime: "anniversary"
  });
  const { row: updated } = await mirrorSubscription(org_id, {
    status: "pending_first_payment",
    plan_activated_at: new Date(),
    cancel_at_period_end: false,
    open_invoice_id: null,
    requires_action_url: null,
    initiated_by: actor || row.initiated_by || "",
    ...noteSelfChange("subscribe")
  });
  logger.info(`[billing] org ${org_id} moved to paid by ${actor || "unknown"}; awaiting first payment`);
  return { plan: PAID_SLUG, status: updated.status };
};

// Cancel at period end: Lago parks a downgrade to free and switches it in
// itself. Credits stay; the paid allowlist stays until then.
export const cancel = async (org_id, { actor = "" } = {}) => {
  const current = await getSubscription(org_id);
  if (current?.plan_slug !== PAID_SLUG) throw new BillingError("this org is not on the paid plan", { permanent: true, statusCode: 409 });
  if (current.pending && current.pending.plan_slug === FREE_SLUG) {
    const { row } = await mirrorSubscription(org_id, { cancel_at_period_end: true });
    return { deferred: true, ends_at: row.current_period_end ?? null, already: true };
  }
  const result = await changeOrgPlan(org_id, FREE_SLUG, { actor: actor || "customer", reason: "cancel at period end", allowDeferred: true });
  if (result.deferred) {
    const { row } = await mirrorSubscription(org_id, { cancel_at_period_end: true, ...noteSelfChange("cancel") });
    return { deferred: true, ends_at: result.ends_at ?? row.current_period_end ?? null };
  }
  // Lago applied it at once (a period boundary, or a plan Lago treats as an upgrade).
  await mirrorSubscription(org_id, {
    status: "canceled",
    cancel_at_period_end: false,
    open_invoice_id: null,
    grace_until: null,
    ...noteSelfChange("cancel")
  });
  return { deferred: false, ends_at: new Date() };
};

// Undo a pending cancellation.
export const resume = async (org_id, { actor = "" } = {}) => {
  const current = await getSubscription(org_id);
  if (current?.plan_slug !== PAID_SLUG || !current.pending || current.pending.plan_slug === PAID_SLUG) {
    throw new BillingError("nothing to resume: no cancellation is pending", { permanent: true, statusCode: 409 });
  }
  await changeOrgPlan(org_id, PAID_SLUG, { actor: actor || "customer", reason: "resume subscription" });
  await mirrorSubscription(org_id, { cancel_at_period_end: false, ...noteSelfChange("resume") });
  return { resumed: true };
};

// "I updated my card, try again now" — instead of waiting for the daily retry.
export const retryOpenInvoice = async (org_id) => {
  const row = await orgBillingService.getByOrg(org_id);
  if (!row?.open_invoice_id) throw new BillingError("no unpaid invoice to retry", { permanent: true, statusCode: 404 });
  const invoice = await getInvoice(row.open_invoice_id);
  if (invoice?.payment_status === "succeeded") {
    // Paid meanwhile; the webhook (or the reconcile) settles the rest.
    return { invoice_id: row.open_invoice_id, status: "already_paid" };
  }
  await retryInvoicePayment(row.open_invoice_id);
  await orgBillingService.incrementRetry(org_id);
  return { invoice_id: row.open_invoice_id, status: "retry_requested" };
};

export const getPortal = async (org_id) => {
  const row = await orgBillingService.getByOrg(org_id);
  if (!row?.payment_provider_code) throw new BillingError("org has no billing account yet", { permanent: true, statusCode: 404 });
  const url = await getPortalUrl(org_id);
  if (!url) throw new BillingError("Lago returned no portal URL", { statusCode: 502 });
  return { url };
};

// What the frontend banner needs: the plan Lago enforces + our state row.
export const getSubscriptionView = async (org_id) => {
  const [plan, row, paid] = await Promise.all([
    getOrgPlanSlug(org_id),
    orgBillingService.getByOrg(org_id),
    billingPlanService.getPlan(PAID_SLUG).catch(() => null)
  ]);
  const status = row?.status ?? "none";
  const onPaid = plan === PAID_SLUG;
  const cancelling = Boolean(row?.cancel_at_period_end);
  return {
    plan,
    billing: {
      status,
      current_period_end: row?.current_period_end ?? null,
      cancel_at_period_end: cancelling,
      grace_until: row?.grace_until ?? null,
      last_payment_error: row?.last_payment_error ?? null,
      requires_action_url: row?.requires_action_url ?? null,
      monthly_credits: Number(paid?.monthly_credits) || null,
      has_payment_method: Boolean(row?.has_payment_method)
    },
    can_checkout: status !== "pending_first_payment",
    can_subscribe: !onPaid && status !== "pending_first_payment" && Boolean(row?.payment_provider_code),
    can_cancel: onPaid && !cancelling && (status === "active" || status === "past_due"),
    can_resume: onPaid && cancelling,
    can_retry: Boolean(row?.open_invoice_id) && (status === "past_due" || status === "pending_first_payment"),
    can_manage: Boolean(row?.payment_provider_code)
  };
};

// ------------------------------------------------------------- signature

// Lago: X-Lago-Signature = base64(HMAC-SHA256(hmac_key, raw body)). Every
// configured key is tried so a rotation ("old,new") is seamless.
export const verifyLagoSignature = (rawBody, headers = {}) => {
  const keys = webhookHmacKeys();
  if (!keys.length) throw new BillingError("LAGO_WEBHOOK_HMAC_KEY is not configured", { statusCode: 500 });
  const algorithm = String(headers["x-lago-signature-algorithm"] ?? "hmac").toLowerCase();
  if (algorithm !== "hmac") throw new BillingError(`unsupported signature algorithm '${algorithm}' (endpoint must use HMAC)`, { statusCode: 400 });
  const signature = headers["x-lago-signature"];
  if (!signature) throw new BillingError("missing X-Lago-Signature header", { statusCode: 400 });
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ""), "utf8");
  const given = Buffer.from(String(signature), "utf8");
  for (const key of keys) {
    const expected = Buffer.from(crypto.createHmac("sha256", key).update(body).digest("base64"), "utf8");
    if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) return true;
  }
  throw new BillingError("invalid webhook signature", { statusCode: 400 });
};

// ------------------------------------------------------------- resolution

// Which org an event belongs to: our external ids ARE the org ids. Never from
// anything a client could set — Lago fills these from its own customer record.
export const resolveOrgId = async ({ webhook_type, object_type, object }) => {
  const direct = object?.external_customer_id ?? object?.customer?.external_id ?? (object_type === "customer" ? object?.external_id : null);
  if (direct) return String(direct);
  const invoiceId = object?.lago_invoice_id ?? (object?.payable_type === "Invoice" ? object?.lago_payable_id : null);
  if (invoiceId) {
    const invoice = await getInvoice(invoiceId).catch(() => null);
    const fromInvoice = invoice?.customer?.external_id ?? invoice?.external_customer_id ?? null;
    if (fromInvoice) return String(fromInvoice);
  }
  logger.warn(`[billing] ${webhook_type}: could not resolve an org from the payload`);
  return null;
};

const invoiceIdOf = ({ object_type, object }) => {
  if (object_type === "invoice") return object?.lago_id ?? null;
  if (object?.lago_invoice_id) return object.lago_invoice_id;
  if (object?.payable_type === "Invoice") return object?.lago_payable_id ?? null;
  return null;
};

const requireOrg = (org_id, what) => {
  if (!org_id) throw new BillingError(`${what}: org not resolved from the Lago payload (customer.external_id missing)`, { permanent: true });
  return org_id;
};

// The webhook hands us the full invoice; a replay or a payment-error event only
// has an id. Fees are needed to tell the paid plan's invoice from the free one.
const fullInvoice = async (object, lago_id) => (Array.isArray(object?.fees) && object?.customer ? object : getInvoice(lago_id ?? object?.lago_id));

// ------------------------------------------------------------- paid cycle

// Lago applies a new wallet's signup grant through an asynchronous transaction:
// for a few seconds after creation the wallet reads credits_balance 0.0, then
// the grant lands. Topping up against that 0.0 would leave the org at
// 8,000 + grant instead of 8,000. Only a wallet created in THIS call can be in
// that state, so the wait is bounded and applies to fresh wallets alone.
const waitForWalletSettlement = async (org_id, wallet) => {
  for (let attempt = 0; attempt < 8 && !(Number(wallet?.credits_balance) > 0); attempt++) {
    await sleep(750);
    wallet = await getWallet(org_id);
  }
  return wallet;
};

// Money landed: top the wallet up TO monthly_credits, bump the shadow balance,
// mark the org active. Each step is checkpointed on the event row so a retry
// after a crash resumes instead of crediting twice; the credit claim makes the
// invoice creditable by exactly one event, whatever delivered the news.
export const applyPaidCycle = async ({ org_id, invoice, unique_key, steps = {} }) => {
  let delta = steps.credit_delta ?? null;

  if (!steps.credited) {
    const owns = await billingEventService.claimCredit(unique_key, invoice.lago_id);
    if (!owns) return { outcome: "processed", note: `invoice ${invoice.lago_id} already credited by another event`, delta: "0" };

    const paidPlan = await getPaidPlanConfig();
    const provisioned = await ensureOrgSubscribed(org_id);
    const walletJustCreated = Boolean(provisioned?.wallet) && !provisioned.wallet.skipped;
    let wallet = await getWallet(org_id);
    if (!wallet) throw new BillingError(`org ${org_id}: wallet missing after ensureOrgSubscribed`);
    if (walletJustCreated) wallet = await waitForWalletSettlement(org_id, wallet);

    delta = computeTopupDelta(spendableCredits(wallet), paidPlan.monthly_credits);
    if (delta !== "0") {
      // Five metadata keys: traceable to the Lago invoice; the period is on the subscription.
      await walletCredit(org_id, delta, {
        source: "stripe-via-lago",
        invoice_id: invoice.lago_id,
        invoice_number: invoice.number ?? "",
        event_key: unique_key,
        reason: "monthly_reset"
      });
    }
    await billingEventService.setStep(unique_key, "credit_delta", delta);
    await billingEventService.setStep(unique_key, "credited", true);
  }

  if (!steps.synced) {
    // An increment, not an overwrite: gtwy-ai mutates this key with INCRBYFLOAT
    // for in-flight holds; a SET would erase them. Redis down => nothing cached
    // => gtwy-ai seeds the post-credit figure from Lago; nothing to do.
    if (client.isReady) await incrementRedisBalance(org_id, delta);
    await billingEventService.setStep(unique_key, "synced", true);
  }

  await invalidatePlanCache(org_id);
  await mirrorSubscription(org_id, {
    status: "active",
    has_payment_method: true,
    last_paid_invoice_id: invoice.lago_id,
    last_paid_at: new Date(),
    last_credit_delta: delta,
    last_payment_error: null,
    requires_action_url: null,
    open_invoice_id: null,
    open_invoice_number: null,
    grace_until: null,
    retry_count: 0
  });
  return { outcome: "processed", delta };
};

// Drop the org to free NOW (terminate + fresh free subscription). Credits stay
// where they are, spendable within the free allowlist.
export const downgradeNow = async (org_id, reason) => {
  const result = await changeOrgPlan(org_id, FREE_SLUG, { actor: "billing", reason, immediate: true });
  await invalidatePlanCache(org_id);
  await mirrorSubscription(org_id, {
    cancel_at_period_end: false,
    grace_until: null,
    requires_action_url: null,
    ...noteSelfChange("downgrade")
  });
  return result;
};

// A subscription invoice did not get paid. First payment -> back to free at
// once (the card was never good). Renewal -> keep Pro, start the grace clock;
// the daily reconcile retries the charge and downgrades when the clock runs out.
export const handlePaymentFailed = async ({ org_id, invoice, error = null }) => {
  const row = await orgBillingService.getByOrg(org_id);
  const paymentError = {
    invoice_id: invoice?.lago_id ?? null,
    invoice_number: invoice?.number ?? null,
    provider_error: error?.provider_error ?? null,
    error_details: error?.error_details ?? null,
    message: error?.provider_error?.message ?? error?.message ?? "payment failed",
    at: new Date()
  };

  const isFirstPayment =
    row?.status === "pending_first_payment" || (!row?.last_paid_invoice_id && hoursAgo(row?.plan_activated_at, 1) && row?.status !== "past_due");

  if (isFirstPayment) {
    await downgradeNow(org_id, `first payment failed on invoice ${invoice?.lago_id}`);
    if (invoice?.lago_id)
      await voidInvoice(invoice.lago_id).catch((err) => alert("lagoInvoiceVoidFailed", `org ${org_id} invoice ${invoice.lago_id}: ${err.message}`));
    await orgBillingService.upsert(org_id, {
      status: "card_failed",
      open_invoice_id: null,
      open_invoice_number: null,
      last_payment_error: paymentError
    });
    alert("lagoFirstPaymentFailed", `org ${org_id}: first Pro payment failed (${paymentError.message}); downgraded to free`);
    return { outcome: "processed", note: "first payment failed; downgraded" };
  }

  if (row?.status === "past_due") {
    await orgBillingService.upsert(org_id, {
      open_invoice_id: invoice?.lago_id ?? row.open_invoice_id,
      open_invoice_number: invoice?.number ?? row.open_invoice_number,
      last_payment_error: paymentError
    });
    return { outcome: "processed", note: "retry failed; still in grace" };
  }

  const days = graceDays();
  if (days === 0) {
    await downgradeNow(org_id, `renewal payment failed on invoice ${invoice?.lago_id}, no grace configured`);
    if (invoice?.lago_id) await voidInvoice(invoice.lago_id).catch(() => {});
    await orgBillingService.upsert(org_id, {
      status: "card_failed",
      open_invoice_id: null,
      open_invoice_number: null,
      last_payment_error: paymentError
    });
    alert("lagoRenewalPaymentFailed", `org ${org_id}: renewal failed, downgraded (grace 0)`);
    return { outcome: "processed", note: "renewal failed; downgraded" };
  }

  await orgBillingService.upsert(org_id, {
    status: "past_due",
    open_invoice_id: invoice?.lago_id ?? null,
    open_invoice_number: invoice?.number ?? null,
    grace_until: plusDays(days),
    retry_count: 0,
    last_retry_at: null,
    last_payment_error: paymentError
  });
  alert("lagoRenewalPaymentFailed", `org ${org_id}: renewal invoice ${invoice?.lago_id} failed (${paymentError.message}); Pro kept for ${days} days`);
  return { outcome: "processed", note: `renewal failed; grace ${days}d` };
};

// --------------------------------------------------------------- handlers

const handleInvoicePaymentStatusUpdated = async ({ object, org_id, unique_key, steps }) => {
  requireOrg(org_id, "invoice.payment_status_updated");
  const invoice = await fullInvoice(object, object?.lago_id);
  if (!invoice) throw new BillingError(`invoice ${object?.lago_id} not found in Lago`, { permanent: true });
  if (invoice.invoice_type !== "subscription") return { outcome: "ignored", note: `${invoice.invoice_type} invoice` };
  if (invoice.status === "voided" || invoice.status === "draft") return { outcome: "ignored", note: `invoice status ${invoice.status}` };

  const paidPlan = await getPaidPlanConfig();
  if (!invoiceIsForPaidPlan(invoice, paidPlan.plan_code)) return { outcome: "ignored", note: "not a paid-plan subscription invoice" };
  if (String(invoice.currency).toLowerCase() !== "usd")
    throw new BillingError(`invoice ${invoice.lago_id} is in ${invoice.currency}, wallet is USD`, { permanent: true });

  switch (invoice.payment_status) {
    case "succeeded": {
      // The fee must have been paid by the card, never by the org's own
      // credits. A wallet that paid any part of it is misconfigured (see
      // ensureWalletPaysChargesOnly); crediting here would refill credits that
      // just paid for themselves. Permanent: a human fixes the wallet and replays.
      if (Number(invoice.prepaid_credit_amount_cents) > 0) {
        alert(
          "lagoFeePaidFromWallet",
          `org ${org_id}: invoice ${invoice.lago_id} had ${invoice.prepaid_credit_amount_cents} cents paid from wallet credits; not crediting`
        );
        throw new BillingError(
          `invoice ${invoice.lago_id}: ${invoice.prepaid_credit_amount_cents} cents were paid from wallet credits, not the card`,
          {
            permanent: true
          }
        );
      }
      const result = await applyPaidCycle({ org_id, invoice, unique_key, steps });
      logger.info(`[billing] org ${org_id}: invoice ${invoice.lago_id} paid, +${result.delta} credits`);
      return result;
    }
    case "failed":
      return handlePaymentFailed({ org_id, invoice, error: null });
    case "pending": {
      // Remember which invoice is open so /retry can address it before a failure lands.
      const row = await orgBillingService.getByOrg(org_id);
      if (row && !row.open_invoice_id && row.status !== "card_failed") {
        await orgBillingService.upsert(org_id, { open_invoice_id: invoice.lago_id, open_invoice_number: invoice.number ?? null });
      }
      return { outcome: "processed", note: "payment pending" };
    }
    default:
      return { outcome: "ignored", note: `payment_status ${invoice.payment_status}` };
  }
};

const handleInvoicePaymentFailure = async ({ object, org_id }) => {
  requireOrg(org_id, "invoice.payment_failure");
  const invoice = await getInvoice(object?.lago_invoice_id);
  if (!invoice) throw new BillingError(`invoice ${object?.lago_invoice_id} not found in Lago`, { permanent: true });
  if (invoice.invoice_type !== "subscription") return { outcome: "ignored", note: `${invoice.invoice_type} invoice` };
  const paidPlan = await getPaidPlanConfig();
  if (!invoiceIsForPaidPlan(invoice, paidPlan.plan_code)) return { outcome: "ignored", note: "not a paid-plan subscription invoice" };
  return handlePaymentFailed({
    org_id,
    invoice,
    error: { provider_error: object?.provider_error ?? null, error_details: object?.error_details ?? null }
  });
};

const handlePaymentRequiresAction = async ({ object, org_id }) => {
  requireOrg(org_id, "payment.requires_action");
  const url = object?.next_action?.redirect_to_url?.url ?? null;
  const invoiceId = object?.payable_type === "Invoice" ? (object?.lago_payable_id ?? null) : null;
  await orgBillingService.upsert(org_id, { requires_action_url: url, ...(invoiceId ? { open_invoice_id: invoiceId } : {}) });
  alert("lagoPaymentRequiresAction", `org ${org_id}: payment needs customer action (3DS) for ${invoiceId ?? "a payment"}`);
  return { outcome: "processed", note: "requires_action recorded" };
};

const handleCustomerProviderCreated = async ({ object, org_id }) => {
  requireOrg(org_id, "customer.payment_provider_created");
  await orgBillingService.upsert(org_id, {
    lago_customer_id: object?.lago_id ?? null,
    stripe_customer_id: object?.billing_configuration?.provider_customer_id ?? object?.provider_customer_id ?? null,
    payment_provider_code: object?.billing_configuration?.payment_provider_code ?? object?.payment_provider_code ?? null
  });
  return { outcome: "processed" };
};

const handleCustomerProviderError = async ({ object, org_id }) => {
  if (org_id) {
    await orgBillingService
      .upsert(org_id, { last_payment_error: { provider_error: object?.provider_error ?? object, at: new Date() } })
      .catch(() => {});
  }
  alert("lagoPaymentProviderError", `org ${org_id ?? "?"}: ${JSON.stringify(object?.provider_error ?? object).slice(0, 500)}`);
  return { outcome: "processed", note: "provider error recorded" };
};

// Lago changed the subscription (a period-end downgrade landing, our own
// changeOrgPlan, an admin edit in the Lago UI). Mirror only — never call
// changeOrgPlan from here, or our own changes would echo back as new changes.
const handleSubscriptionChanged = async ({ org_id, webhook_type }) => {
  requireOrg(org_id, webhook_type);
  await invalidatePlanCache(org_id);
  const row = await orgBillingService.getByOrg(org_id);
  const { subscription } = await mirrorSubscription(org_id);
  const nowFree = subscription && !subscription.pending_only && subscription.plan_slug === FREE_SLUG;
  if (nowFree && row && (row.status === "active" || row.status === "past_due") && row.cancel_at_period_end) {
    await orgBillingService.upsert(org_id, { status: "canceled", cancel_at_period_end: false, open_invoice_id: null, grace_until: null });
    logger.info(`[billing] org ${org_id}: cancellation took effect (${webhook_type})`);
  }
  return { outcome: "processed" };
};

const handleRecordOnly = async ({ webhook_type }) => ({ outcome: "processed", note: `${webhook_type} recorded` });

const HANDLERS = {
  "invoice.payment_status_updated": handleInvoicePaymentStatusUpdated,
  "invoice.payment_failure": handleInvoicePaymentFailure,
  "payment.requires_action": handlePaymentRequiresAction,
  "customer.payment_provider_created": handleCustomerProviderCreated,
  "customer.payment_provider_error": handleCustomerProviderError,
  "subscription.started": handleSubscriptionChanged,
  "subscription.terminated": handleSubscriptionChanged
};

// ----------------------------------------------------------- entry point

// Process one Lago event. NEVER throws; returns { status, http } for the
// controller. 200 = processed / ignored / duplicate / permanent failure (a
// human acts); 500 = transient failure, Lago retries and the reconcile replays.
export const processLagoEvent = async ({ unique_key, webhook_type, object_type, object, synthetic = false }) => {
  if (!unique_key) return { status: "failed", http: 400 };
  const invoice_id = invoiceIdOf({ object_type, object });
  const org_id = await resolveOrgId({ webhook_type, object_type, object }).catch(() => null);

  let claimed;
  try {
    claimed = await billingEventService.claim({
      unique_key,
      webhook_type,
      object_type,
      object,
      org_id,
      invoice_id,
      subscription_external_id: object_type === "subscription" ? (object?.external_id ?? null) : null,
      synthetic
    });
  } catch (err) {
    logger.error(`[billing] could not record event ${unique_key}: ${err.message}`);
    return { status: "failed", http: 500 };
  }

  let row = claimed.doc;
  if (!claimed.fresh) {
    if (!row) return { status: "failed", http: 500 };
    if (row.status === "processed" || row.status === "ignored") return { status: "duplicate", http: 200 };
    if (row.status === "failed" && row.permanent) return { status: "failed_permanent", http: 200 };
    row = await billingEventService.reclaim(unique_key);
    // Another replica is on it right now. 200, not 500: Lago's few fast retries
    // would only collide with the same in-flight run.
    if (!row) return { status: "in_progress", http: 200 };
  }
  if (org_id && !row.org_id) await billingEventService.setOrg(unique_key, org_id).catch(() => {});

  const handler = HANDLERS[webhook_type] ?? (RECORD_ONLY_EVENTS.has(webhook_type) ? handleRecordOnly : null);
  if (!handler) {
    await billingEventService.markIgnored(unique_key, `unhandled type ${webhook_type}`);
    return { status: "ignored", http: 200 };
  }

  try {
    const result = await handler({ object, org_id, unique_key, webhook_type, steps: row.steps ?? {} });
    if (result.outcome === "ignored") {
      await billingEventService.markIgnored(unique_key, result.note ?? "");
      return { status: "ignored", http: 200 };
    }
    await billingEventService.markProcessed(unique_key, result.note ?? "");
    return { status: "processed", http: 200, note: result.note };
  } catch (err) {
    const permanent = err instanceof BillingError && err.permanent;
    await billingEventService.markFailed(unique_key, err, { permanent }).catch(() => {});
    const attempts = Number(row.attempts) || 1;
    if (permanent) {
      logger.error(`[billing] event ${unique_key} (${webhook_type}) failed permanently: ${err.message}`);
      alert("lagoEventFailedPermanent", `${unique_key} ${webhook_type} org=${org_id ?? "?"}: ${err.message}`);
      return { status: "failed_permanent", http: 200 };
    }
    logger.error(`[billing] event ${unique_key} (${webhook_type}) failed (attempt ${attempts}): ${err.message}`);
    if (attempts >= 3) alert("lagoEventFailing", `${unique_key} ${webhook_type} org=${org_id ?? "?"} attempt ${attempts}: ${err.message}`);
    return { status: "failed", http: 500 };
  }
};

// Rebuild a stored event (re-fetching the live invoice from Lago where it
// matters) and run it again. Admin-driven, so a permanent failure is made
// retryable first — a human has presumably fixed the cause.
export const replayEvent = async (unique_key) => {
  const row = await billingEventService.getByKey(unique_key);
  if (!row) throw new BillingError(`no stored event ${unique_key}`, { permanent: true, statusCode: 404 });
  let object = row.snapshot ?? {};
  if (row.object_type === "invoice" && (row.invoice_id || object.lago_id)) {
    object = (await getInvoice(row.invoice_id ?? object.lago_id)) ?? object;
  }
  if (row.status === "failed" && row.permanent)
    await billingEventService.markFailed(unique_key, row.error || "replay requested", { permanent: false });
  return processLagoEvent({ unique_key, webhook_type: row.webhook_type, object_type: row.object_type, object, synthetic: Boolean(row.synthetic) });
};

// -------------------------------------------------------------- reconcile

const syntheticPaidEvent = (invoice) => ({
  unique_key: `reconcile:${invoice.lago_id}`,
  webhook_type: "invoice.payment_status_updated",
  object_type: "invoice",
  object: invoice,
  synthetic: true
});

// Every org that might be paying: our rows plus every Lago subscription on the paid plan.
const collectPayingOrgs = async (summary) => {
  const orgs = new Set();
  for (const row of await orgBillingService.listByStatus(["active", "past_due", "pending_first_payment"])) orgs.add(String(row.org_id));
  for (let page = 1; page < 50; page++) {
    const { subscriptions, meta } = await listSubscriptionsByPlan(PAID_SLUG, { page }).catch((err) => {
      summary.errors.push({ step: "list_paid_subscriptions", page, error: err.message });
      return { subscriptions: [], meta: {} };
    });
    for (const sub of subscriptions) if (sub.external_customer_id) orgs.add(String(sub.external_customer_id));
    if (!meta?.next_page) break;
  }
  return orgs;
};

// Nightly. (1) credit any PAID subscription invoice we never processed — the
// guarantee behind "money taken, credits never granted"; (2) retry the open
// invoice of every org in grace, once a day; (3) downgrade orgs whose grace ran
// out; (4) settle first payments stuck for a day; (5) fix Lago-vs-Redis plan
// drift; (6) replay retryable failed events. Idempotent, and safe against a
// live webhook landing concurrently thanks to the credit claim.
export const reconcileBilling = async ({ dryRun = true, lookbackDays = 45 } = {}) => {
  const summary = { dry_run: dryRun, checked: 0, credited: [], retried: [], downgraded: [], cache_fixed: [], replayed: 0, errors: [] };
  const since = Date.now() - lookbackDays * 86400_000;
  let paidPlan = null;
  try {
    paidPlan = await getPaidPlanConfig();
  } catch (err) {
    summary.errors.push({ step: "config", error: err.message });
    return summary;
  }

  // (1) missed payments
  for (const org_id of await collectPayingOrgs(summary)) {
    summary.checked += 1;
    try {
      const invoices = await listInvoices(org_id, { payment_status: "succeeded", invoice_type: "subscription", per_page: 24 });
      for (const invoice of invoices) {
        if (new Date(invoice.created_at ?? invoice.issuing_date).getTime() < since) continue;
        if (invoice.status === "voided") continue;
        if (!invoiceIsForPaidPlan(invoice, paidPlan.plan_code)) continue;
        if (await billingEventService.hasCreditedInvoice(invoice.lago_id)) continue;
        summary.credited.push({ org_id, invoice: invoice.lago_id, number: invoice.number });
        if (!dryRun) await processLagoEvent(syntheticPaidEvent(invoice));
      }
    } catch (err) {
      summary.errors.push({ org_id, step: "missed_payments", error: err.message });
    }
  }

  // (2) retries + (3) grace expiry
  const now = Date.now();
  for (const row of await orgBillingService.listByStatus(["past_due"])) {
    try {
      const invoice = row.open_invoice_id ? await getInvoice(row.open_invoice_id).catch(() => null) : null;
      if (invoice?.payment_status === "succeeded") continue; // step (1) credits it
      const graceUntil = row.grace_until ? new Date(row.grace_until).getTime() : null;
      if (graceUntil !== null && graceUntil <= now) {
        summary.downgraded.push({ org_id: row.org_id, invoice: row.open_invoice_id, reason: "grace expired" });
        if (!dryRun) {
          await downgradeNow(row.org_id, `grace period expired; invoice ${row.open_invoice_id} unpaid`);
          if (row.open_invoice_id) await voidInvoice(row.open_invoice_id).catch(() => {});
          await orgBillingService.upsert(row.org_id, { status: "card_failed", open_invoice_id: null, open_invoice_number: null });
        }
        continue;
      }
      const lastRetry = row.last_retry_at ? new Date(row.last_retry_at).getTime() : 0;
      if (row.open_invoice_id && now - lastRetry >= 20 * 3600_000) {
        summary.retried.push({ org_id: row.org_id, invoice: row.open_invoice_id, attempt: (row.retry_count ?? 0) + 1 });
        if (!dryRun) {
          await retryInvoicePayment(row.open_invoice_id);
          await orgBillingService.incrementRetry(row.org_id);
        }
      }
    } catch (err) {
      summary.errors.push({ org_id: row.org_id, step: "grace", error: err.message });
    }
  }

  // (4) first payments stuck for a day: Lago never told us, so ask.
  for (const row of await orgBillingService.listByStatus(["pending_first_payment"])) {
    if (hoursAgo(row.plan_activated_at, 24)) continue;
    try {
      const unpaid = await listInvoices(row.org_id, { invoice_type: "subscription", per_page: 5 });
      const invoice = unpaid.find(
        (inv) => inv.payment_status !== "succeeded" && inv.status !== "voided" && invoiceIsForPaidPlan(inv, paidPlan.plan_code)
      );
      if (!invoice) continue;
      summary.downgraded.push({ org_id: row.org_id, invoice: invoice.lago_id, reason: "first payment never succeeded" });
      if (!dryRun) await handlePaymentFailed({ org_id: row.org_id, invoice, error: { message: "first payment not completed within 24h" } });
    } catch (err) {
      summary.errors.push({ org_id: row.org_id, step: "stuck_first_payment", error: err.message });
    }
  }

  // (5) plan drift
  for (const row of await orgBillingService.listByStatus(["active", "past_due", "pending_first_payment", "canceled", "card_failed"])) {
    try {
      const drift = await reconcileOrgPlan(row.org_id);
      if (drift?.drift) {
        summary.cache_fixed.push(row.org_id);
        if (!dryRun) await invalidatePlanCache(row.org_id);
      }
    } catch (err) {
      summary.errors.push({ org_id: row.org_id, step: "drift", error: err.message });
    }
  }

  // (6) replay
  if (!dryRun) {
    for (const row of await billingEventService.listFailedRetryable({ olderThanMs: 10 * 60_000, maxAttempts: 10 })) {
      const result = await replayEvent(row.unique_key).catch((err) => ({ status: `error: ${err.message}` }));
      if (result.status === "processed") summary.replayed += 1;
    }
  }

  const line =
    `checked=${summary.checked} credited=${summary.credited.length} retried=${summary.retried.length} ` +
    `downgraded=${summary.downgraded.length} cache_fixed=${summary.cache_fixed.length} replayed=${summary.replayed} errors=${summary.errors.length}`;
  logger.info(`[billing] reconcile ${dryRun ? "(dry run) " : ""}${line}`);
  if (!dryRun && (summary.credited.length || summary.downgraded.length)) alert("lagoReconcileChanges", line);
  return summary;
};

export const RECONCILE_LOCK_KEY = redis_keys.billing_reconcile_lock;
