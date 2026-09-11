import logger from "../logger.js";
import client from "./cache.service.js";
import { REDIS_PREFIX } from "../cache_service/index.js";
import { redis_keys } from "../configs/constant.js";
import { PLAN_SLUGS } from "../configs/billingPlans.js";
import {
  getStripe,
  isLiveMode,
  webhookSecrets,
  idOf,
  invoiceSubscriptionId,
  invoiceSubscriptionMetadata,
  invoiceLines,
  linePriceId,
  subscriptionPriceId,
  subscriptionPeriod,
  toDate
} from "../configs/stripe.js";
import {
  changeOrgPlan,
  ensureOrgSubscribed,
  getOrgPlanSlug,
  getSubscription as getLagoSubscription,
  getWallet,
  invalidatePlanCache,
  reconcileOrgPlan,
  syncWalletBalanceToRedis,
  walletCredit
} from "./lago.service.js";
import billingPlanService from "../db_services/billingPlan.service.js";
import orgBillingService from "../db_services/orgBilling.service.js";
import stripeEventService from "../db_services/stripeEvent.service.js";
import { unknown_error_handler_alert } from "./utils/utility.service.js";

// The $20/month Pro subscription. Stripe is money + subscription + dunning;
// Lago is credits + the plan gtwy-ai enforces. They meet in processStripeEvent.
//
// The one signal that money landed is `invoice.paid` — for the first payment
// and for every renewal alike. It runs applyProCycle: make sure the Lago wallet
// exists, top it up TO monthly_credits (Lago wallets only ADD, so "reset to
// 8,000" is delta = max(0, 8000 - balance)), move the org to the paid plan,
// refresh the Redis shadow balance. Downgrade happens only on a TERMINAL
// subscription status (Stripe gave up retrying), never on the first failed
// charge. Credits are never clawed back.

// ---------------------------------------------------------------- errors

// Two failure classes, two HTTP answers. Transient (Lago/Mongo/Redis/Stripe
// unreachable, plan-change lock held, plan doc not yet configured) -> 500 so
// Stripe retries for up to 3 days. Permanent (unknown org, wrong currency,
// wrong mode) -> 200 + alert, so a bad data condition can never get the
// endpoint disabled and a human fixes it via replay.
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

// Stripe subscription statuses that mean "this org is a paying customer".
const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);
// Statuses Stripe reaches only after it has given up collecting.
const TERMINAL_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired"]);
// Only these invoices reset the wallet. A proration or a one-off must never
// top an org up to 8,000.
const CYCLE_REASONS = new Set(["subscription_create", "subscription_cycle"]);
// Recorded and alerted, never acted on, in v1.
const RECORD_ONLY_EVENTS = new Set([
  "charge.refunded",
  "charge.dispute.created",
  "invoice.voided",
  "invoice.marked_uncollectible",
  "customer.subscription.paused"
]);

const alert = (type, reason) => {
  try {
    unknown_error_handler_alert(type, null, reason);
  } catch {
    // alerting must never break billing
  }
};

// ------------------------------------------------------------ pure helpers

// How many credits to add so the wallet lands on `target`. Never negative:
// an org already above the target gets nothing added and nothing taken. A
// negative balance (the -100 overdraft floor) yields target + |balance|, which
// is exactly "reset to target". Returns a decimal string (Lago takes strings).
export const computeTopupDelta = (ongoingBalance, target) => {
  const current = Number(ongoingBalance);
  const goal = Number(target);
  if (!Number.isFinite(current)) throw new BillingError(`wallet ongoing balance is not numeric: ${ongoingBalance}`);
  if (!Number.isFinite(goal) || goal <= 0) throw new BillingError(`invalid monthly_credits target: ${target}`);
  const delta = goal - current;
  if (delta <= 0) return "0";
  return String(Number(delta.toFixed(4)));
};

const isLive = (status) => LIVE_STATUSES.has(status);
const isTerminal = (status) => TERMINAL_STATUSES.has(status);

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

// ---------------------------------------------------------------- config

// stripe_price_id + monthly_credits live on the `paid` billing_plans document
// (editable via PUT /api/billing-plans, per environment). Missing values are a
// TRANSIENT failure on purpose: fixing the document makes the next retry
// succeed, and we never credit 0 or a guess.
export const getPaidPlanConfig = async () => {
  const plan = await billingPlanService.getPlan(PAID_SLUG);
  if (!plan) throw new BillingError(`billing_plans has no '${PAID_SLUG}' document`);
  const monthly_credits = Number(plan.monthly_credits);
  if (!Number.isFinite(monthly_credits) || monthly_credits <= 0) {
    throw new BillingError(`billing_plans.${PAID_SLUG}.monthly_credits is not a positive number (${plan.monthly_credits})`);
  }
  if (!plan.stripe_price_id) throw new BillingError(`billing_plans.${PAID_SLUG}.stripe_price_id is not set`);
  return { stripe_price_id: String(plan.stripe_price_id), monthly_credits, display_name: plan.display_name };
};

// ----------------------------------------------------------------- locks

const lockKey = (name) => `${REDIS_PREFIX}${name}`;

// SET NX EX. Redis down => acquired (fail open), same policy as claimPlanChange.
const acquireLock = async (key, ttlSeconds) => {
  if (!client.isReady) return true;
  const ok = await client.set(lockKey(key), "1", { NX: true, EX: ttlSeconds }).catch(() => null);
  return ok !== null;
};

const releaseLock = async (key) => {
  if (!client.isReady) return;
  await client.del(lockKey(key)).catch(() => {});
};

// -------------------------------------------------------------- customers

// Mongo mirror -> Stripe search by our metadata -> create. The idempotency key
// only covers 24h on Stripe's side, so the search is what stops a stale mirror
// from minting a second customer for the same org.
export const findOrCreateCustomer = async (org_id, { email = null, stripe = null } = {}) => {
  const api = stripe ?? getStripe();
  const existing = await orgBillingService.getByOrg(org_id);
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const found = await api.customers.search({ query: `metadata['org_id']:'${String(org_id)}'`, limit: 1 });
  let customerId = found?.data?.[0]?.id ?? null;

  if (!customerId) {
    const created = await api.customers.create(
      { metadata: { org_id: String(org_id) }, name: `org-${org_id}`, ...(email ? { email } : {}) },
      { idempotencyKey: `org:${org_id}:customer` }
    );
    customerId = created.id;
  }

  const stored = await orgBillingService.setCustomerIfUnset(org_id, customerId);
  if (stored?.stripe_customer_id && stored.stripe_customer_id !== customerId) {
    // Lost a race with a concurrent checkout; theirs is canonical.
    logger.warn(`[stripe] org ${org_id}: customer ${customerId} is an orphan, using ${stored.stripe_customer_id}`);
    return stored.stripe_customer_id;
  }
  if (!stored) {
    const winner = await orgBillingService.getByOrg(org_id);
    if (winner?.stripe_customer_id) return winner.stripe_customer_id;
  }
  return customerId;
};

// -------------------------------------------------------------- checkout

export const createCheckoutSession = async (org_id, { email = null, initiated_by = "", stripe = null } = {}) => {
  const api = stripe ?? getStripe();
  const lock = `${redis_keys.stripe_checkout_lock_}${org_id}`;
  if (!(await acquireLock(lock, 15))) {
    throw new BillingError("a checkout for this org is already being created", { permanent: true, statusCode: 409 });
  }
  try {
    const plan = await getPaidPlanConfig();
    const customer = await findOrCreateCustomer(org_id, { email, stripe: api });

    // Truth check in Stripe, not just our mirror: an org that already pays
    // must not be able to open a second subscription.
    const subs = await api.subscriptions.list({ customer, status: "all", limit: 20 });
    const dayAgo = Math.floor(Date.now() / 1000) - 86400;
    const live = (subs?.data ?? []).find(
      (s) => isLive(s.status) || s.status === "unpaid" || (s.status === "incomplete" && Number(s.created) > dayAgo)
    );
    if (live) {
      await mirrorSubscription(org_id, live);
      throw new BillingError(`org already has a ${live.status} subscription`, { permanent: true, statusCode: 409 });
    }

    // Two tabs must not mean two subscriptions: reuse an open session.
    const row = await orgBillingService.getByOrg(org_id);
    if (row?.pending_checkout_session_id) {
      const open = await api.checkout.sessions.retrieve(row.pending_checkout_session_id).catch(() => null);
      if (open?.status === "open" && open.url) return { url: open.url, session_id: open.id, reused: true };
    }

    const session = await api.checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      client_reference_id: String(org_id),
      metadata: { org_id: String(org_id) },
      // Read back by every webhook: WHO this subscription belongs to and WHAT
      // they bought. Resolving the plan from this, not from the price id, is
      // what keeps old subscribers working when the price is rotated.
      subscription_data: { metadata: { org_id: String(org_id), plan_slug: PAID_SLUG } },
      success_url: process.env.STRIPE_CHECKOUT_SUCCESS_URL,
      cancel_url: process.env.STRIPE_CHECKOUT_CANCEL_URL,
      payment_method_collection: "always",
      allow_promotion_codes: false
    });

    await orgBillingService.upsert(org_id, {
      stripe_customer_id: customer,
      pending_checkout_session_id: session.id,
      pending_checkout_expires_at: toDate(session.expires_at),
      initiated_by: initiated_by || ""
    });
    return { url: session.url, session_id: session.id, reused: false };
  } finally {
    await releaseLock(lock);
  }
};

export const createPortalSession = async (org_id, { stripe = null } = {}) => {
  const api = stripe ?? getStripe();
  const row = await orgBillingService.getByOrg(org_id);
  if (!row?.stripe_customer_id) throw new BillingError("org has no Stripe customer yet", { permanent: true, statusCode: 404 });
  const session = await api.billingPortal.sessions.create({
    customer: row.stripe_customer_id,
    return_url: process.env.STRIPE_PORTAL_RETURN_URL
  });
  return { url: session.url };
};

// What the frontend banner needs: the plan Lago enforces + the Stripe mirror.
export const getSubscriptionView = async (org_id) => {
  const [plan, row, paid] = await Promise.all([
    getOrgPlanSlug(org_id),
    orgBillingService.getByOrg(org_id),
    billingPlanService.getPlan(PAID_SLUG).catch(() => null)
  ]);
  const status = row?.status ?? "none";
  return {
    plan,
    stripe: {
      status,
      current_period_end: row?.current_period_end ?? null,
      cancel_at_period_end: Boolean(row?.cancel_at_period_end),
      last_payment_error: row?.last_payment_error ?? null,
      price_id: row?.stripe_price_id ?? null,
      monthly_credits: Number(paid?.monthly_credits) || null
    },
    can_checkout: !isLive(status) && status !== "unpaid",
    can_manage: Boolean(row?.stripe_customer_id)
  };
};

// ------------------------------------------------------------- signatures

// Tries every configured secret so a rotation ("old,new") is seamless. The
// SDK's default 300s timestamp tolerance is kept; replays inside it are
// harmless because of event_id dedup.
export const constructWebhookEvent = (rawBody, signatureHeader, { stripe = null } = {}) => {
  const api = stripe ?? getStripe();
  const secrets = webhookSecrets();
  if (!secrets.length) throw new BillingError("STRIPE_WEBHOOK_SECRET is not configured", { statusCode: 500 });
  if (!signatureHeader) throw new BillingError("missing stripe-signature header", { statusCode: 400 });
  let lastError = null;
  for (const secret of secrets) {
    try {
      return api.webhooks.constructEvent(rawBody, signatureHeader, secret);
    } catch (err) {
      lastError = err;
    }
  }
  throw new BillingError(`invalid signature: ${lastError?.message ?? "no secret matched"}`, { statusCode: 400 });
};

// ------------------------------------------------------------- resolution

const customerIdOf = (object) => idOf(object?.customer);

// Which org an event belongs to. Order: metadata WE stamped at Checkout, then
// our mirror by customer, then the Stripe customer's own metadata. Never the
// request body. Returns null when nothing resolves; callers that need an org
// turn that into a PERMANENT failure (a human sets the metadata and replays).
export const resolveOrgId = async (event, api) => {
  const type = event?.type ?? "";
  const object = event?.data?.object ?? {};
  let candidate = null;

  if (type.startsWith("invoice.")) candidate = invoiceSubscriptionMetadata(object)?.org_id ?? object?.metadata?.org_id ?? null;
  else if (type.startsWith("customer.subscription.")) candidate = object?.metadata?.org_id ?? null;
  else if (type === "checkout.session.completed") candidate = object?.metadata?.org_id ?? object?.client_reference_id ?? null;
  else if (type.startsWith("charge.")) candidate = object?.metadata?.org_id ?? null;
  if (candidate) return String(candidate);

  const customer = customerIdOf(object);
  if (!customer) return null;
  const row = await orgBillingService.getByCustomer(customer);
  if (row?.org_id) return String(row.org_id);

  const remote = await api.customers.retrieve(customer).catch(() => null);
  const fromStripe = remote?.metadata?.org_id ?? null;
  return fromStripe ? String(fromStripe) : null;
};

// Which of our plans an invoice pays for. Metadata first (set by us, covered by
// the signature). Price second, for subscriptions ops created in the Dashboard
// without metadata. A mismatch against the CURRENT price id only alerts — old
// subscribers keep the price they signed up at.
export const resolvePlanSlug = (invoice, subscription, paidPlan) => {
  const fromMeta = subscription?.metadata?.plan_slug ?? invoiceSubscriptionMetadata(invoice)?.plan_slug ?? null;
  if (fromMeta && PLAN_SLUGS.includes(fromMeta)) {
    const priceOnSub = subscriptionPriceId(subscription);
    if (paidPlan && priceOnSub && priceOnSub !== paidPlan.stripe_price_id) {
      alert("stripePriceMismatch", `subscription ${subscription?.id} pays price ${priceOnSub}, current paid price is ${paidPlan.stripe_price_id}`);
    }
    return fromMeta;
  }
  const prices = new Set([...invoiceLines(invoice).map(linePriceId), subscriptionPriceId(subscription)].filter(Boolean));
  if (paidPlan && prices.has(paidPlan.stripe_price_id)) {
    alert("stripeSubscriptionWithoutPlanMetadata", `subscription ${subscription?.id} has no plan_slug metadata; matched by price`);
    return PAID_SLUG;
  }
  throw new BillingError(`cannot resolve a plan for invoice ${invoice?.id} (prices: ${[...prices].join(",") || "none"})`, { permanent: true });
};

// ------------------------------------------------------------------ mirror

// Rewrite the org's Stripe mirror from a FRESH subscription object. A second
// live subscription on the same org is recorded and alerted, never silently
// adopted, so the primary id stays stable.
export const mirrorSubscription = async (org_id, sub) => {
  const row = await orgBillingService.getByOrg(org_id);
  const period = subscriptionPeriod(sub);
  const fields = {
    stripe_customer_id: customerIdOf(sub) ?? row?.stripe_customer_id ?? null,
    stripe_subscription_id: sub.id,
    stripe_price_id: subscriptionPriceId(sub),
    plan_slug: PLAN_SLUGS.includes(sub?.metadata?.plan_slug) ? sub.metadata.plan_slug : (row?.plan_slug ?? null),
    status: sub.status,
    current_period_start: toDate(period.start),
    current_period_end: toDate(period.end),
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    canceled_at: toDate(sub.canceled_at)
  };

  const otherLive = row?.stripe_subscription_id && row.stripe_subscription_id !== sub.id && isLive(row.status) && isLive(sub.status);
  if (otherLive) {
    await orgBillingService.pushDuplicateSubscription(org_id, sub.id);
    alert("stripeDuplicateSubscription", `org ${org_id} has live subscriptions ${row.stripe_subscription_id} and ${sub.id}`);
    // Keep the existing primary; only refresh the customer id.
    await orgBillingService.upsert(org_id, { stripe_customer_id: fields.stripe_customer_id });
    return row;
  }
  return orgBillingService.upsert(org_id, fields);
};

// ------------------------------------------------------------- pro cycle

// Lago answered but did not activate the plan yet ("pending"). For a downgrade
// that is acceptable — the org keeps Pro until Lago's period turns and the
// nightly reconcile confirms convergence — so it is permanent, not a 3-day
// 500 loop. For an upgrade it must not happen; it stays transient.
const isPendingPlanChange = (err) => /did not activate/i.test(String(err?.message ?? ""));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

// credit -> plan -> cache, each step checkpointed on the event row, so a retry
// after a crash resumes where it stopped instead of crediting twice.
export const applyProCycle = async ({ org_id, invoice, subscription, event_id, steps = {}, paidPlan }) => {
  // Guarantees a Lago customer, a subscription and a wallet exist (idempotent).
  const provisioned = await ensureOrgSubscribed(org_id);
  const walletJustCreated = Boolean(provisioned?.wallet) && !provisioned.wallet.skipped;

  let delta = steps.credit_delta ?? null;
  if (!steps.credited) {
    let wallet = await getWallet(org_id);
    if (!wallet) throw new BillingError(`org ${org_id}: wallet missing after ensureOrgSubscribed`);
    if (walletJustCreated) wallet = await waitForWalletSettlement(org_id, wallet);
    delta = computeTopupDelta(spendableCredits(wallet), paidPlan.monthly_credits);
    if (delta !== "0") {
      // Lago allows AT MOST 5 metadata keys on a wallet transaction and rejects
      // the whole credit with 422 "too_many_keys" otherwise. These five make a
      // charge traceable to the Stripe invoice; the period is on the subscription.
      await walletCredit(org_id, delta, {
        source: "stripe",
        invoice_id: invoice.id,
        subscription_id: subscription.id,
        event_id,
        billing_reason: invoice.billing_reason ?? ""
      });
    }
    await stripeEventService.setStep(event_id, "credit_delta", delta);
    await stripeEventService.setStep(event_id, "credited", true);
  }

  if (!steps.plan_changed) {
    // Throws on lock contention -> transient -> 500 -> Stripe retries after the 30s lock is gone.
    await changeOrgPlan(org_id, PAID_SLUG, { actor: "stripe", reason: `invoice ${invoice.id}` });
    await stripeEventService.setStep(event_id, "plan_changed", true);
  }

  if (!steps.synced) {
    // A silent skip here would leave a paying customer with a stale shadow
    // balance indefinitely (gtwy-ai only seeds it NX), so Redis being down is
    // a failed event, retried until the SET lands.
    if (!client.isReady) throw new BillingError("redis unavailable — shadow balance not synced");
    await syncWalletBalanceToRedis(org_id);
    await stripeEventService.setStep(event_id, "synced", true);
  }

  await orgBillingService.upsert(org_id, {
    status: "active",
    plan_slug: PAID_SLUG,
    last_invoice_id: invoice.id,
    last_paid_at: toDate(invoice.status_transitions?.paid_at) ?? new Date(),
    last_credit_delta: delta,
    last_payment_error: null,
    pending_checkout_session_id: null,
    pending_checkout_expires_at: null
  });
  return { delta };
};

// Drop the org to the free plan — but only if THIS subscription is the one we
// track for the org and no other live subscription remains on the customer.
// Credits stay where they are (spendable within the free allowlist).
export const endProAccess = async ({ org_id, subscription, reason, api }) => {
  const row = await orgBillingService.getByOrg(org_id);
  if (row?.stripe_subscription_id && row.stripe_subscription_id !== subscription.id) {
    alert(
      "stripeOtherSubscriptionEnded",
      `org ${org_id}: ${subscription.id} ended but tracked subscription is ${row.stripe_subscription_id}; not downgrading`
    );
    return { downgraded: false, reason: "not the tracked subscription" };
  }
  const customer = customerIdOf(subscription) ?? row?.stripe_customer_id;
  if (customer) {
    const subs = await api.subscriptions.list({ customer, status: "all", limit: 20 });
    const others = (subs?.data ?? []).filter((s) => s.id !== subscription.id && isLive(s.status));
    if (others.length) {
      alert(
        "stripeOtherSubscriptionStillActive",
        `org ${org_id}: ${subscription.id} ended but ${others.map((s) => s.id).join(",")} still live; not downgrading`
      );
      await mirrorSubscription(org_id, others[0]);
      return { downgraded: false, reason: "another live subscription" };
    }
  }
  try {
    await changeOrgPlan(org_id, FREE_SLUG, { actor: "stripe", reason });
  } catch (err) {
    if (isPendingPlanChange(err)) {
      alert("stripeDowngradePending", `org ${org_id}: Lago deferred the downgrade (${err.message}); reconcile will confirm`);
      throw new BillingError(err.message, { permanent: true });
    }
    throw err;
  }
  await orgBillingService.upsert(org_id, {
    status: subscription.status,
    canceled_at: toDate(subscription.canceled_at) ?? new Date(),
    cancel_at_period_end: false,
    pending_checkout_session_id: null,
    pending_checkout_expires_at: null
  });
  return { downgraded: true };
};

// --------------------------------------------------------------- handlers

const requireOrg = (org_id, what) => {
  if (!org_id) throw new BillingError(`${what}: org not resolved (set metadata.org_id on the Stripe customer and replay)`, { permanent: true });
  return org_id;
};

// The webhook hands us the full object; a replay only has a trimmed snapshot.
const fullInvoice = async (object, api) => (object?.lines?.data ? object : api.invoices.retrieve(object.id, { expand: ["lines"] }));

const handleCheckoutCompleted = async ({ object, org_id, api, event_id }) => {
  if (object.mode !== "subscription") return { outcome: "ignored", note: `checkout mode ${object.mode}` };
  requireOrg(org_id, "checkout.session.completed");
  const subId = idOf(object.subscription);
  if (!subId) return { outcome: "ignored", note: "checkout session without subscription" };
  const sub = await api.subscriptions.retrieve(subId);
  await mirrorSubscription(org_id, sub);
  await orgBillingService.upsert(org_id, { pending_checkout_session_id: null, pending_checkout_expires_at: null });
  await stripeEventService.setStep(event_id, "mirrored", true);
  return { outcome: "processed" };
};

const handleInvoicePaid = async ({ object, org_id, api, event_id, steps }) => {
  requireOrg(org_id, "invoice.paid");
  const invoice = await fullInvoice(object, api);

  // Invariants, in order. Each names the money-safety rule it enforces.
  if (invoice.status !== "paid") return { outcome: "ignored", note: `invoice.paid with status ${invoice.status}` };
  if (String(invoice.currency).toLowerCase() !== "usd")
    throw new BillingError(`invoice ${invoice.id} is in ${invoice.currency}, wallet is USD`, { permanent: true });
  if (!CYCLE_REASONS.has(invoice.billing_reason)) {
    alert("stripeNonCycleInvoicePaid", `invoice ${invoice.id} (${invoice.billing_reason}) paid for org ${org_id}; recorded, no credits`);
    await stripeEventService.setStep(event_id, "recorded", true);
    return { outcome: "processed", note: `non-cycle invoice ${invoice.billing_reason}` };
  }
  const subId = invoiceSubscriptionId(invoice);
  if (!subId) throw new BillingError(`invoice ${invoice.id} has no subscription`, { permanent: true });
  const subscription = await api.subscriptions.retrieve(subId);
  const paidPlan = await getPaidPlanConfig();
  const slug = resolvePlanSlug(invoice, subscription, paidPlan);
  if (slug !== PAID_SLUG)
    throw new BillingError(`invoice ${invoice.id} resolves to plan '${slug}', only '${PAID_SLUG}' is sold`, { permanent: true });
  if (Number(invoice.amount_paid) === 0)
    alert("stripeZeroAmountInvoice", `invoice ${invoice.id} for org ${org_id} paid $0 (coupon or out of band); crediting anyway`);

  const { delta } = await applyProCycle({ org_id, invoice, subscription, event_id, steps, paidPlan });
  await mirrorSubscription(org_id, subscription);
  logger.info(`[stripe] org ${org_id}: invoice ${invoice.id} paid, +${delta} credits, plan paid`);
  return { outcome: "processed" };
};

const handleInvoicePaymentFailed = async ({ object, org_id, api }) => {
  requireOrg(org_id, "invoice.payment_failed");
  const invoice = object;
  const subId = invoiceSubscriptionId(invoice);
  const sub = subId ? await api.subscriptions.retrieve(subId).catch(() => null) : null;
  if (sub) await mirrorSubscription(org_id, sub);
  const error = invoice.last_finalization_error ?? null;
  await orgBillingService.upsert(org_id, {
    ...(sub ? {} : { status: "past_due" }),
    last_payment_error: {
      invoice_id: invoice.id,
      code: error?.code ?? null,
      decline_code: error?.decline_code ?? null,
      message: error?.message ?? "payment failed",
      attempt_count: invoice.attempt_count ?? null,
      next_payment_attempt: toDate(invoice.next_payment_attempt),
      at: new Date()
    }
  });
  // No plan change: Stripe retries for ~2 weeks and emails the customer.
  alert("stripePaymentFailed", `org ${org_id}: invoice ${invoice.id} payment failed (attempt ${invoice.attempt_count ?? "?"})`);
  return { outcome: "processed" };
};

const handleSubscriptionChanged = async ({ object, org_id, api, event }) => {
  requireOrg(org_id, event.type);
  const sub = await api.subscriptions.retrieve(object.id);
  await mirrorSubscription(org_id, sub);
  // Which event is terminal depends on the Dashboard's "after all retries"
  // setting (cancel -> .deleted; mark unpaid -> .updated{unpaid}). Handle both.
  if (isTerminal(sub.status)) await endProAccess({ org_id, subscription: sub, reason: `subscription ${sub.id} ${sub.status}`, api });
  return { outcome: "processed" };
};

const handleSubscriptionDeleted = async ({ object, org_id, api }) => {
  requireOrg(org_id, "customer.subscription.deleted");
  const sub = (await api.subscriptions.retrieve(object.id).catch(() => null)) ?? object;
  await endProAccess({ org_id, subscription: sub, reason: `subscription ${sub.id} deleted`, api });
  return { outcome: "processed" };
};

const handleRecordOnly = async ({ event, org_id, event_id }) => {
  await stripeEventService.setStep(event_id, "recorded", true);
  alert("stripeNeedsHumanReview", `${event.type} ${event.data?.object?.id} for org ${org_id ?? "?"} — recorded, no automatic action`);
  return { outcome: "processed", note: "record only" };
};

const HANDLERS = {
  "checkout.session.completed": handleCheckoutCompleted,
  "invoice.paid": handleInvoicePaid,
  "invoice.payment_failed": handleInvoicePaymentFailed,
  "customer.subscription.created": handleSubscriptionChanged,
  "customer.subscription.updated": handleSubscriptionChanged,
  "customer.subscription.deleted": handleSubscriptionDeleted
};

// ----------------------------------------------------------- entry point

const idsFor = (event) => {
  const type = event?.type ?? "";
  const object = event?.data?.object ?? {};
  if (type.startsWith("invoice.")) return { invoice_id: object.id ?? null, subscription_id: invoiceSubscriptionId(object) };
  if (type.startsWith("customer.subscription.")) return { invoice_id: null, subscription_id: object.id ?? null };
  if (type === "checkout.session.completed") return { invoice_id: null, subscription_id: idOf(object.subscription) };
  return { invoice_id: null, subscription_id: null };
};

// Process one Stripe event. NEVER throws; returns { status, http } for the
// controller. `stripe` may be injected (smoke tests, replay) — it is a
// dependency, not an auth bypass: signature verification happens before this.
export const processStripeEvent = async (event, { stripe = null } = {}) => {
  const api = stripe ?? getStripe();
  const type = event?.type ?? "";
  const object = event?.data?.object ?? {};

  // Mode isolation. Signatures differ per mode anyway; this is belt and braces.
  if (Boolean(event.livemode) !== isLiveMode()) {
    await stripeEventService.recordAlias(event, "livemode mismatch").catch(() => {});
    alert("stripeLivemodeMismatch", `event ${event.id} livemode=${event.livemode} hit a ${isLiveMode() ? "live" : "test"} server`);
    return { status: "ignored", http: 200 };
  }

  const { invoice_id, subscription_id } = idsFor(event);
  const org_id = await resolveOrgId(event, api).catch(() => null);

  let claimed;
  try {
    claimed = await stripeEventService.claim(event, { org_id, invoice_id, subscription_id });
  } catch (err) {
    logger.error(`[stripe] could not record event ${event.id}: ${err.message}`);
    return { status: "failed", http: 500 };
  }

  let row = claimed.doc;
  if (!claimed.fresh) {
    if (!row) return { status: "failed", http: 500 };
    if (row.event_id !== event.id) {
      // Same invoice, different event id: the partial unique index fired.
      await stripeEventService.recordAlias(event, `duplicate of ${row.event_id} for invoice ${invoice_id}`).catch(() => {});
      const settled = row.status === "processed" || row.status === "ignored" || (row.status === "failed" && row.permanent);
      return settled ? { status: "duplicate", http: 200 } : { status: "in_progress", http: 500 };
    }
    if (row.status === "processed" || row.status === "ignored") return { status: "duplicate", http: 200 };
    if (row.status === "failed" && row.permanent) return { status: "failed_permanent", http: 200 };
    row = await stripeEventService.reclaim(event.id);
    if (!row) return { status: "in_progress", http: 500 };
  }
  if (org_id && !row.org_id) await stripeEventService.setOrg(event.id, org_id).catch(() => {});

  const handler = HANDLERS[type] ?? (RECORD_ONLY_EVENTS.has(type) ? handleRecordOnly : null);
  if (!handler) {
    await stripeEventService.markIgnored(event.id, `unhandled type ${type}`);
    return { status: "ignored", http: 200 };
  }

  try {
    const result = await handler({ event, object, org_id, api, event_id: event.id, steps: row.steps ?? {} });
    if (result.outcome === "ignored") {
      await stripeEventService.markIgnored(event.id, result.note ?? "");
      return { status: "ignored", http: 200 };
    }
    await stripeEventService.markProcessed(event.id);
    return { status: "processed", http: 200 };
  } catch (err) {
    const permanent = err instanceof BillingError && err.permanent;
    await stripeEventService.markFailed(event.id, err, { permanent }).catch(() => {});
    const attempts = Number(row.attempts) || 1;
    if (permanent) {
      logger.error(`[stripe] event ${event.id} (${type}) failed permanently: ${err.message}`);
      alert("stripeEventFailedPermanent", `${event.id} ${type} org=${org_id ?? "?"}: ${err.message}`);
      return { status: "failed_permanent", http: 200 };
    }
    logger.error(`[stripe] event ${event.id} (${type}) failed (attempt ${attempts}): ${err.message}`);
    if (attempts >= 3) alert("stripeEventFailing", `${event.id} ${type} org=${org_id ?? "?"} attempt ${attempts}: ${err.message}`);
    return { status: "failed", http: 500 };
  }
};

// Rebuild a stored event from its snapshot (re-fetching the live object from
// Stripe) and run it again. Admin-driven, so a permanent failure is made
// retryable first — a human has presumably fixed the cause.
export const replayStripeEvent = async (event_id, { stripe = null } = {}) => {
  const api = stripe ?? getStripe();
  const row = await stripeEventService.getByEventId(event_id);
  if (!row) throw new BillingError(`no stored event ${event_id}`, { permanent: true, statusCode: 404 });
  const id = row.snapshot?.id ?? row.invoice_id ?? row.subscription_id;
  let object = row.snapshot ?? {};
  if (row.type.startsWith("invoice.") && id) object = await api.invoices.retrieve(id, { expand: ["lines"] });
  else if (row.type.startsWith("customer.subscription.") && id) object = await api.subscriptions.retrieve(id);
  else if (row.type === "checkout.session.completed" && id) object = await api.checkout.sessions.retrieve(id);
  if (row.status === "failed" && row.permanent) await stripeEventService.markFailed(event_id, row.error || "replay requested", { permanent: false });
  const event = {
    id: row.event_id,
    type: row.type,
    livemode: Boolean(row.livemode),
    created: row.created ? Math.floor(new Date(row.created).getTime() / 1000) : Math.floor(Date.now() / 1000),
    api_version: row.api_version ?? null,
    data: { object }
  };
  return processStripeEvent(event, { stripe: api });
};

// -------------------------------------------------------------- reconcile

const syntheticInvoicePaid = (invoice) => ({
  id: `reconcile:${invoice.id}`,
  type: "invoice.paid",
  livemode: isLiveMode(),
  created: Math.floor(Date.now() / 1000),
  api_version: null,
  data: { object: invoice }
});

// Nightly. Three jobs: (1) credit any PAID invoice Stripe has that we never
// processed — the guarantee for "money taken, credits never granted";
// (2) fix plan drift between Stripe's subscription status and Lago's plan;
// (3) replay retryable failed events. Idempotent, and safe against a live
// webhook landing concurrently thanks to the partial unique index.
export const reconcileStripeSubscriptions = async ({ dryRun = true, stripe = null, lookbackDays = 45 } = {}) => {
  const api = stripe ?? getStripe();
  const summary = { dry_run: dryRun, checked: 0, credited: [], downgraded: [], upgraded: [], cache_fixed: [], replayed: 0, errors: [] };
  const since = Math.floor(Date.now() / 1000) - lookbackDays * 86400;

  for (const status of ["active", "past_due"]) {
    for await (const sub of api.subscriptions.list({ status, limit: 100 })) {
      summary.checked += 1;
      const org_id = await resolveOrgId({ type: "customer.subscription.updated", data: { object: sub } }, api).catch(() => null);
      if (!org_id) {
        summary.errors.push({ subscription: sub.id, error: "org not resolved" });
        continue;
      }
      try {
        const invoices = await api.invoices.list({ subscription: sub.id, status: "paid", created: { gte: since }, limit: 24 });
        for (const invoice of invoices.data) {
          if (!CYCLE_REASONS.has(invoice.billing_reason)) continue;
          if (await stripeEventService.hasProcessedInvoice(invoice.id)) continue;
          summary.credited.push({ org_id, invoice: invoice.id });
          if (!dryRun) await processStripeEvent(syntheticInvoicePaid(invoice), { stripe: api });
        }
        const lago = await getLagoSubscription(org_id).catch(() => null);
        if (lago && !lago.pending_only && lago.plan_slug !== PAID_SLUG) {
          summary.upgraded.push({ org_id, subscription: sub.id });
          if (!dryRun) await changeOrgPlan(org_id, PAID_SLUG, { actor: "stripe-reconcile", reason: `subscription ${sub.id} is ${sub.status}` });
        }
        if (!dryRun) await mirrorSubscription(org_id, sub);
      } catch (err) {
        summary.errors.push({ org_id, subscription: sub.id, error: err.message });
      }
    }
  }

  // Orgs we think are paying but Stripe says are not.
  for (const row of await orgBillingService.listByStatus(["active", "past_due", "trialing", "unpaid", "incomplete"])) {
    if (!row.stripe_subscription_id) continue;
    try {
      const sub = await api.subscriptions.retrieve(row.stripe_subscription_id);
      if (!dryRun) await mirrorSubscription(row.org_id, sub);
      if (isTerminal(sub.status)) {
        const lago = await getLagoSubscription(row.org_id).catch(() => null);
        if (lago?.plan_slug === PAID_SLUG) {
          summary.downgraded.push({ org_id: row.org_id, subscription: sub.id, status: sub.status });
          if (!dryRun)
            await endProAccess({ org_id: row.org_id, subscription: sub, reason: `reconcile: subscription ${sub.status}`, api }).catch((err) =>
              summary.errors.push({ org_id: row.org_id, error: err.message })
            );
        }
      }
      const drift = await reconcileOrgPlan(row.org_id).catch(() => null);
      if (drift?.drift) {
        summary.cache_fixed.push(row.org_id);
        if (!dryRun) await invalidatePlanCache(row.org_id);
      }
    } catch (err) {
      summary.errors.push({ org_id: row.org_id, error: err.message });
    }
  }

  if (!dryRun) {
    for (const row of await stripeEventService.listFailedRetryable({ olderThanMs: 10 * 60_000, maxAttempts: 10 })) {
      const result = await replayStripeEvent(row.event_id, { stripe: api }).catch((err) => ({ status: `error: ${err.message}` }));
      if (result.status === "processed") summary.replayed += 1;
    }
  }

  const line = `checked=${summary.checked} credited=${summary.credited.length} upgraded=${summary.upgraded.length} downgraded=${summary.downgraded.length} cache_fixed=${summary.cache_fixed.length} replayed=${summary.replayed} errors=${summary.errors.length}`;
  logger.info(`[stripe] reconcile ${dryRun ? "(dry run) " : ""}${line}`);
  if (!dryRun && (summary.credited.length || summary.downgraded.length || summary.upgraded.length)) alert("stripeReconcileChanges", line);
  return summary;
};

export const RECONCILE_LOCK_KEY = redis_keys.stripe_reconcile_lock;
export { acquireLock, releaseLock };
