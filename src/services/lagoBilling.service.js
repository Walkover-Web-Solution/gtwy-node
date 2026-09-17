import crypto from "crypto";
import logger from "../logger.js";
import client from "./cache.service.js";
import { REDIS_PREFIX } from "../cache_service/index.js";
import { redis_keys } from "../configs/constant.js";
import { planCodeFor } from "../configs/billingPlans.js";
import { graceDays, webhookHmacKeys } from "../configs/lagoBilling.js";
import {
  CREDIT_PACK_ADD_ON_CODE,
  changeOrgPlan,
  createCreditPackInvoice,
  ensureCreditPackAddOn,
  ensureOrgSubscribed,
  ensureWalletInvariants,
  getCheckoutUrl,
  getInvoice,
  getLagoPlan,
  getOrgPlanSlug,
  getPortalUrl,
  getSubscription,
  getWallet,
  incrementRedisBalance,
  invalidatePlanCache,
  invoicePaymentUrl,
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

// How many credits a paid invoice adds to the wallet. Two modes, because
// upgrading and renewing are not the same event.
//
// GRANT — the org has just upgraded, so ADD the whole monthly allowance on top
//   of what it already holds. Upgrading must not confiscate credits the org
//   had already been given: 100 left over on the free plan becomes 8,100, not
//   8,000. An org below zero (the -100 overdraft floor) has the allowance added
//   to its debt, which is the honest arithmetic — it already spent those
//   credits — so it lands on 7,900.
//
// RESET — a renewal, so top the wallet up TO the allowance. Unused credits do
//   not pile up month after month, and an org already above the allowance gets
//   nothing added and nothing taken. Never negative: credits are never clawed
//   back.
//
// Returns a decimal string; Lago takes strings.
export const CREDIT_GRANT = "grant";
export const CREDIT_RESET = "reset";

// Is this paid invoice the FIRST of a subscription (an upgrade), or a renewal?
// subscribe() stamps pending_first_payment on every upgrade, including a
// customer who cancelled earlier and is coming back, so that flag is the
// signal. An org that has never paid us at all — moved onto the plan by an
// admin, or with no billing row yet — counts as an upgrade too, because it has
// no earlier allowance to be renewing.
export const isFirstPaidCycle = (row) => row?.status === "pending_first_payment" || !row?.last_paid_invoice_id;

// How much of the wallet is credits the org BOUGHT rather than was granted.
// Lago holds one balance, so the split is a convention: usage comes out of the
// monthly allowance first, and the purchased pile only starts draining once the
// allowance is gone. Never more than the wallet actually holds.
export const remainingPurchasedCredits = (spendable, purchasedBalance) => {
  const purchased = Math.max(0, Number(purchasedBalance) || 0);
  const current = Number(spendable);
  if (!Number.isFinite(current)) return purchased;
  return Math.min(Math.max(current, 0), purchased);
};

export const computeCreditDelta = (spendable, monthly, mode = CREDIT_RESET, purchasedBalance = 0) => {
  const allowance = Number(monthly);
  if (!Number.isFinite(allowance) || allowance <= 0) throw new BillingError(`invalid monthly_credits target: ${monthly}`);
  if (mode === CREDIT_GRANT) return String(Number(allowance.toFixed(4)));

  const current = Number(spendable);
  if (!Number.isFinite(current)) throw new BillingError(`wallet balance is not numeric: ${spendable}`);
  // Only the ALLOWANCE part of the balance is reset. Credits the org bought sit
  // on top and are carried over untouched, otherwise buying extra credits would
  // cannibalise the next month: an org holding more than the allowance would be
  // topped up by nothing and would have paid for a month it never received.
  const allowanceRemaining = current - remainingPurchasedCredits(current, purchasedBalance);
  const delta = allowance - allowanceRemaining;
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
    await ensureWalletInvariants(org_id);
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

// ----------------------------------------------------------- credit packs

// The product's standing offer, used when a plan document does not name its
// own packs. A plan CAN name them — billing_plans.<slug>.credit_packs, editable
// through PUT /api/billing-plans with no deploy — which is also how a plan is
// stopped from offering any: store an empty list.
const DEFAULT_CREDIT_PACKS_USD = [10, 20, 50, 100];

export const creditPacksForPlan = (plan) => {
  const stored = plan?.credit_packs;
  if (!Array.isArray(stored)) return DEFAULT_CREDIT_PACKS_USD;
  const packs = stored.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(packs)].sort((a, b) => a - b);
};

// What the org can buy, and what each pack is worth. The credits are NOT a
// stored number: they are the USD amount divided by the org's own credit rate,
// which is the same rate its usage is charged at. So a pack is priced by the
// one pricing rule the product already has, and it stays right in an
// environment whose rate differs. The offer comes from the org's CURRENT plan,
// so Pro and free can be given different packs, or free none at all.
export const listCreditPacks = async (org_id) => {
  const [wallet, slug, row] = await Promise.all([getWallet(org_id), getOrgPlanSlug(org_id), orgBillingService.getByOrg(org_id)]);
  const rate = Number(wallet?.rate_amount) || Number(process.env.LAGO_CREDIT_RATE_USD);
  if (!Number.isFinite(rate) || rate <= 0) throw new BillingError("credit rate is not configured, cannot price a pack", { statusCode: 500 });
  const planDoc = await billingPlanService.getPlan(slug).catch(() => null);
  const packs = creditPacksForPlan(planDoc).map((usd) => ({ usd, credits: Math.round(usd / rate) }));
  return {
    plan: slug,
    packs,
    currency: wallet?.currency ?? "USD",
    rate_per_credit: String(rate),
    balance: wallet ? String(spendableCredits(wallet)) : null,
    purchased_balance: Number(row?.credits_purchased_balance) || 0,
    // No card needed up front: paying on Lago's hosted Stripe page saves one.
    can_buy: packs.length > 0,
    has_payment_method: Boolean(row?.has_payment_method),
    pending_purchases: row?.pending_credit_purchases ?? {},
    // Everything a "buying credits…" screen needs to stop waiting: the last
    // pack that landed, a 3DS page the customer must visit, or the decline.
    last_purchase: row?.last_credit_purchase_at
      ? { credits: row.last_credit_purchase_credits, at: row.last_credit_purchase_at, invoice_id: row.last_credit_purchase_invoice_id }
      : null,
    requires_action_url: row?.requires_action_url ?? null,
    last_payment_error: row?.last_payment_error ?? null
  };
};

// A credit-pack invoice that has been paid. Routed through the ordinary event
// path — the one the webhook takes — so the credits are granted once, the
// bookkeeping is checkpointed, and the webhook that follows is a harmless repeat.
const recordPaidCreditPack = async (org_id, invoice) => {
  try {
    return await processLagoEvent(syntheticPaidEvent(invoice));
  } catch (err) {
    // Never fail the request over the bookkeeping: the money is taken. The
    // reconcile picks this up within the day.
    logger.error(`[billing] org ${org_id}: credit pack ${invoice?.lago_id} paid but not yet recorded (${err.message})`);
    alert("lagoCreditPurchaseUnrecorded", `org ${org_id}: invoice ${invoice?.lago_id} paid but bookkeeping failed: ${err.message}`);
    return null;
  }
};

// Buy one pack. Every purchase is paid on a hosted Stripe page — the customer
// confirms there, Stripe charges, Lago records the payment, and our webhook
// grants the credits. Never a charge behind the customer's back.
//
// Why a ONE-OFF invoice and not a wallet top-up: Lago charges a saved card off
// session the instant it raises a wallet top-up, and on the Lago this runs
// against (v1.42.0) the flag that would stop it is stored but ignored. A
// one-off invoice raised with skip_psp is left unpaid, so Lago can hand out a
// payment page for it. Verified live 2026-09-17. Revenue still lands in Lago as
// a paid invoice; the wallet cannot pay for its own pack because it is
// restricted to usage charges.
//
// Nothing is granted until the money is in. The amount is matched against the
// packs the org's plan actually offers rather than taken as given, which would
// otherwise let a caller mint whatever charge it liked.
export const purchaseCredits = async (org_id, usd, { email = null, actor = "" } = {}) => {
  const amount = Number(usd);
  const lock = `${redis_keys.billing_checkout_lock_}purchase:${org_id}`;
  if (!(await acquireLock(lock, 20))) {
    throw new BillingError("a credit purchase for this org is already being created", { permanent: true, statusCode: 409 });
  }
  try {
    const row = await orgBillingService.getByOrg(org_id);

    // The same pack still has an open page? Hand back that page rather than
    // raising another invoice against the customer. Paid meanwhile? That IS the
    // purchase — report it, do not charge for it twice.
    const pending = row?.pending_credit_purchases?.[String(amount)];
    if (pending?.invoice_id && hoursAgo(pending.at, 24)) {
      const existing = await getInvoice(pending.invoice_id).catch(() => null);
      if (existing?.payment_status === "succeeded") {
        await recordPaidCreditPack(org_id, existing);
        return {
          status: "paid",
          usd: amount,
          credits: pending.credits,
          invoice_id: pending.invoice_id,
          reused: true,
          note: "this purchase has already been paid"
        };
      }
      if (existing && existing.status !== "voided") {
        const url = await invoicePaymentUrl(pending.invoice_id).catch(() => null);
        if (url) {
          return {
            status: "payment_required",
            url,
            usd: amount,
            credits: pending.credits,
            invoice_id: pending.invoice_id,
            reused: true,
            note: "finish the payment on this page"
          };
        }
      }
    }

    // Provision so an org that never had a wallet can buy, keep the wallet from
    // paying invoices with itself, and attach the Stripe connection — the page
    // is built against Lago's Stripe customer for the org. No card is needed:
    // the page collects one and Stripe saves it.
    await ensureOrgSubscribed(org_id);
    await ensureWalletInvariants(org_id);
    const customer = await setCustomerPaymentProvider(org_id, { email });

    const { packs, rate_per_credit, plan } = await listCreditPacks(org_id);
    const pack = packs.find((p) => p.usd === amount);
    if (!pack) {
      const offered = packs.map((p) => `$${p.usd}`).join(", ") || "none";
      throw new BillingError(`${usd} is not a credit pack offered on the '${plan}' plan (${offered})`, { permanent: true, statusCode: 400 });
    }

    await ensureCreditPackAddOn();
    const invoice = await createCreditPackInvoice(org_id, { usd: amount, credits: pack.credits, actor });
    const url = await invoicePaymentUrl(invoice.lago_id).catch((err) => {
      logger.error(`[billing] org ${org_id}: no payment page for credit-pack invoice ${invoice.lago_id}: ${err.message}`);
      return null;
    });
    if (!url) {
      // Do not leave an unpayable invoice on the customer's account.
      await voidInvoice(invoice.lago_id).catch(() => {});
      throw new BillingError("Lago returned no payment page for the credit purchase", { statusCode: 502 });
    }

    await orgBillingService.upsert(org_id, {
      [`pending_credit_purchases.${amount}`]: {
        invoice_id: invoice.lago_id,
        invoice_number: invoice.number ?? null,
        usd: amount,
        credits: pack.credits,
        at: new Date()
      },
      payment_provider_code: customer?.billing_configuration?.payment_provider_code ?? process.env.LAGO_STRIPE_PROVIDER_CODE ?? null,
      stripe_customer_id: customer?.billing_configuration?.provider_customer_id ?? row?.stripe_customer_id ?? null,
      lago_customer_id: customer?.lago_id ?? row?.lago_customer_id ?? null,
      initiated_by: actor || row?.initiated_by || ""
    });
    logger.info(`[billing] org ${org_id}: credit pack of ${pack.credits} for $${amount} awaiting payment on Stripe (${actor || "unknown"})`);
    return {
      status: "payment_required",
      url,
      usd: amount,
      credits: pack.credits,
      rate_per_credit,
      invoice_id: invoice.lago_id,
      reused: false,
      note: "pay on this page and the credits arrive"
    };
  } finally {
    await releaseLock(lock);
  }
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
  const [plan, row, paid, lagoPaid] = await Promise.all([
    getOrgPlanSlug(org_id),
    orgBillingService.getByOrg(org_id),
    billingPlanService.getPlan(PAID_SLUG).catch(() => null),
    getLagoPlan(PAID_SLUG).catch(() => {
      return null;
    })
  ]);
  const status = row?.status ?? "none";
  const onPaid = plan === PAID_SLUG;
  const cancelling = Boolean(row?.cancel_at_period_end);
  return {
    plan,
    paid_plan: {
      code: PAID_SLUG,
      display_name: paid?.display_name ?? lagoPaid?.name ?? null,
      monthly_credits: Number(paid?.monthly_credits) || null,
      price: lagoPaid ? { amount_cents: lagoPaid.amount_cents, currency: lagoPaid.amount_currency, interval: lagoPaid.interval } : null
    },
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
  // Read back on a retry: the split of the wallet into allowance and purchased
  // credits was decided when the credit was computed, and must be what is
  // written at the end even if the run crashed in between.
  let carriedPurchased = steps.carried_purchased ?? null;

  if (!steps.credited) {
    const owns = await billingEventService.claimCredit(unique_key, invoice.lago_id);
    if (!owns) return { outcome: "processed", note: `invoice ${invoice.lago_id} already credited by another event`, delta: "0" };

    const paidPlan = await getPaidPlanConfig();
    const provisioned = await ensureOrgSubscribed(org_id);
    const walletJustCreated = Boolean(provisioned?.wallet) && !provisioned.wallet.skipped;
    let wallet = await getWallet(org_id);
    if (!wallet) throw new BillingError(`org ${org_id}: wallet missing after ensureOrgSubscribed`);
    if (walletJustCreated) wallet = await waitForWalletSettlement(org_id, wallet);

    // Read the row BEFORE the mirror at the bottom of this function stamps it
    // active: that is what tells an upgrade apart from a renewal.
    const row = await orgBillingService.getByOrg(org_id);
    const isUpgrade = isFirstPaidCycle(row);
    const spendable = spendableCredits(wallet);
    // Credits the org bought are carried over rather than reset, so the renewal
    // tops up the allowance only. What is left of them becomes the new figure.
    carriedPurchased = remainingPurchasedCredits(spendable, row?.credits_purchased_balance);

    delta = computeCreditDelta(spendable, paidPlan.monthly_credits, isUpgrade ? CREDIT_GRANT : CREDIT_RESET, row?.credits_purchased_balance);
    if (delta !== "0") {
      // Five metadata keys: traceable to the Lago invoice; the period is on the subscription.
      await walletCredit(org_id, delta, {
        source: "stripe-via-lago",
        invoice_id: invoice.lago_id,
        invoice_number: invoice.number ?? "",
        event_key: unique_key,
        reason: isUpgrade ? "upgrade_grant" : "monthly_reset"
      });
    }
    await billingEventService.setStep(unique_key, "credit_delta", delta);
    await billingEventService.setStep(unique_key, "carried_purchased", carriedPurchased);
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
    ...(carriedPurchased === null ? {} : { credits_purchased_balance: carriedPurchased }),
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

// Is this one-off invoice one of ours for a credit pack? Told by the add-on it
// bills, which nothing else in the product uses — or, when the payload carries
// no fee lines, by the `source` we stamped into its metadata. Lago's invoice
// LIST omits `fees` (only GET /invoices/:id includes them; verified live
// 2026-09-17), so a reconcile reading the list would otherwise never recognise
// a pack. Metadata IS in the list.
export const isCreditPackInvoice = (invoice) => {
  if (invoice?.invoice_type !== "one_off") return false;
  if ((Array.isArray(invoice?.fees) ? invoice.fees : []).some((fee) => fee?.item?.code === CREDIT_PACK_ADD_ON_CODE)) return true;
  return (Array.isArray(invoice?.metadata) ? invoice.metadata : []).some((m) => m?.key === "source" && m?.value === "credit-pack");
};

// The org's one-off credit-pack invoices in a payment state, from Lago's list.
// A one-off invoice the list cannot identify (no metadata — the stamp after
// creation failed) is fetched in full so its fee lines can tell.
const listCreditPackInvoices = async (org_id, payment_status) => {
  const oneOffs = await listInvoices(org_id, { payment_status, invoice_type: "one_off", per_page: 24 });
  const packs = [];
  for (const invoice of oneOffs) {
    if (isCreditPackInvoice(invoice)) packs.push(invoice);
    else if (!Array.isArray(invoice.fees)) {
      const full = await getInvoice(invoice.lago_id).catch(() => null);
      if (isCreditPackInvoice(full)) packs.push(full);
    }
  }
  return packs;
};

// How many credits a paid credit invoice is worth. Our one-off packs say so in
// their metadata, written when the invoice was raised, so this does not divide
// dollars by a rate that may since have moved. A wallet top-up made through
// Lago's own portal (`credit` type) carries them on the fee line as units. The
// amount over the current rate is the last resort.
export const purchasedCreditsOf = (invoice) => {
  const meta = Array.isArray(invoice?.metadata) ? invoice.metadata.find((m) => m?.key === "credits") : null;
  const fromMeta = Number(meta?.value);
  if (Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta;
  if (invoice?.invoice_type === "credit") {
    const fees = Array.isArray(invoice?.fees) ? invoice.fees : [];
    const units = fees.reduce((total, fee) => total + (Number(fee?.units) || 0), 0);
    if (units > 0) return units;
  }
  const rate = Number(process.env.LAGO_CREDIT_RATE_USD);
  const cents = Number(invoice?.total_amount_cents);
  if (Number.isFinite(rate) && rate > 0 && Number.isFinite(cents) && cents > 0) return Math.round(cents / 100 / rate);
  return 0;
};

// A credit purchase reached a payment outcome. Two kinds arrive here: our own
// one-off credit-pack invoices, where WE grant the credits once paid; and wallet
// top-ups made through Lago's portal (`credit` type), where Lago has already put
// the credits in the wallet and only the bookkeeping is ours — the Redis shadow
// balance the request gate reads, and the purchased balance the next renewal
// must leave alone. Each step is checkpointed so a retry after a crash can
// neither grant nor count anything twice.
const handleCreditPurchaseInvoice = async ({ invoice, org_id, unique_key, steps }) => {
  requireOrg(org_id, "credit purchase");
  const weGrant = isCreditPackInvoice(invoice);
  if (invoice.payment_status === "pending") return { outcome: "processed", note: "credit purchase pending payment" };
  if (invoice.payment_status !== "succeeded") {
    await orgBillingService.upsert(org_id, {
      last_payment_error: { invoice_id: invoice.lago_id, message: "credit purchase was not paid", at: new Date() }
    });
    alert("lagoCreditPurchaseFailed", `org ${org_id}: credit purchase ${invoice.lago_id} was not paid; no credits granted`);
    return { outcome: "processed", note: "credit purchase failed" };
  }
  if (String(invoice.currency).toLowerCase() !== "usd") {
    throw new BillingError(`invoice ${invoice.lago_id} is in ${invoice.currency}, wallet is USD`, { permanent: true });
  }
  if (Number(invoice.prepaid_credit_amount_cents) > 0) {
    // The wallet paid for its own top-up: impossible while ensureWalletInvariants
    // holds, so a human should look before anything is granted.
    throw new BillingError(`credit purchase ${invoice.lago_id} was paid from wallet credits, not the card`, { permanent: true });
  }

  const credits = purchasedCreditsOf(invoice);
  if (!credits) throw new BillingError(`credit invoice ${invoice.lago_id} carries no credit amount`, { permanent: true });

  if (!steps.credited) {
    // One claim per invoice, so a redelivery or a reconcile replay cannot grant
    // or bump twice.
    const owns = await billingEventService.claimCredit(unique_key, invoice.lago_id);
    if (!owns) return { outcome: "processed", note: `credit purchase ${invoice.lago_id} already applied`, delta: "0" };
    if (weGrant) {
      await walletCredit(org_id, credits, {
        source: "credit-pack",
        invoice_id: invoice.lago_id,
        invoice_number: invoice.number ?? "",
        event_key: unique_key,
        reason: "credit_pack"
      });
    }
    await billingEventService.setStep(unique_key, "credit_delta", String(credits));
    await billingEventService.setStep(unique_key, "credited", true);
  }

  if (!steps.synced) {
    if (client.isReady) await incrementRedisBalance(org_id, credits);
    await billingEventService.setStep(unique_key, "synced", true);
  }

  // Checkpointed like the steps above: this is an $inc, so a retry after a crash
  // between here and markProcessed would otherwise count the pack twice.
  if (!steps.recorded) {
    await orgBillingService.clearPendingPurchases(org_id, [invoice.lago_id]);
    await orgBillingService.addPurchasedCredits(org_id, credits, {
      has_payment_method: true,
      last_credit_purchase_at: new Date(),
      last_credit_purchase_credits: String(credits),
      last_credit_purchase_invoice_id: invoice.lago_id,
      last_payment_error: null
    });
    await billingEventService.setStep(unique_key, "recorded", true);
  }

  logger.info(`[billing] org ${org_id}: credit pack paid, +${credits} credits (invoice ${invoice.lago_id}${weGrant ? "" : ", credited by Lago"})`);
  return { outcome: "processed", note: `credit pack +${credits}` };
};

const handleInvoicePaymentStatusUpdated = async ({ object, org_id, unique_key, steps }) => {
  requireOrg(org_id, "invoice.payment_status_updated");
  const invoice = await fullInvoice(object, object?.lago_id);
  if (!invoice) throw new BillingError(`invoice ${object?.lago_id} not found in Lago`, { permanent: true });
  if (invoice.status === "voided" || invoice.status === "draft") return { outcome: "ignored", note: `invoice status ${invoice.status}` };
  // Our credit-pack invoices (one-off, billing the credit_pack add-on) and Lago
  // portal top-ups (`credit`) are credit purchases, not the subscription fee.
  if (invoice.invoice_type === "credit" || isCreditPackInvoice(invoice)) return handleCreditPurchaseInvoice({ invoice, org_id, unique_key, steps });
  if (invoice.invoice_type !== "subscription") return { outcome: "ignored", note: `${invoice.invoice_type} invoice` };

  const paidPlan = await getPaidPlanConfig();
  if (!invoiceIsForPaidPlan(invoice, paidPlan.plan_code)) return { outcome: "ignored", note: "not a paid-plan subscription invoice" };
  if (String(invoice.currency).toLowerCase() !== "usd")
    throw new BillingError(`invoice ${invoice.lago_id} is in ${invoice.currency}, wallet is USD`, { permanent: true });

  switch (invoice.payment_status) {
    case "succeeded": {
      // The fee must have been paid by the card, never by the org's own
      // credits. A wallet that paid any part of it is misconfigured (see
      // ensureWalletInvariants); crediting here would refill credits that
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

const handleInvoicePaymentFailure = async ({ object, org_id, unique_key, steps }) => {
  requireOrg(org_id, "invoice.payment_failure");
  const invoice = await getInvoice(object?.lago_invoice_id);
  if (!invoice) throw new BillingError(`invoice ${object?.lago_invoice_id} not found in Lago`, { permanent: true });
  // A declined credit pack: record it so the UI can say so. Lago reports the
  // decline here before payment_status catches up, hence the override.
  if (invoice.invoice_type === "credit" || isCreditPackInvoice(invoice)) {
    return handleCreditPurchaseInvoice({ invoice: { ...invoice, payment_status: "failed" }, org_id, unique_key, steps });
  }
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
// retryable first — a human has presumably fixed the cause. An IGNORED event is
// replayable too: a build that did not yet handle its kind may have ignored it
// (a paid credit-pack invoice reaching a server without the pack handler is
// marked "one_off invoice"), and after the deploy the replay is how those
// customers get what they paid for without waiting for the nightly reconcile.
export const replayEvent = async (unique_key) => {
  const row = await billingEventService.getByKey(unique_key);
  if (!row) throw new BillingError(`no stored event ${unique_key}`, { permanent: true, statusCode: 404 });
  let object = row.snapshot ?? {};
  if (row.object_type === "invoice" && (row.invoice_id || object.lago_id)) {
    object = (await getInvoice(row.invoice_id ?? object.lago_id)) ?? object;
  }
  if ((row.status === "failed" && row.permanent) || row.status === "ignored")
    await billingEventService.markFailed(unique_key, row.error || "replay requested", { permanent: false });
  return processLagoEvent({ unique_key, webhook_type: row.webhook_type, object_type: row.object_type, object, synthetic: Boolean(row.synthetic) });
};

// -------------------------------------------------------------- reconcile

// A pack invoice still unpaid this long after its Stripe page (24h) has expired
// is abandoned. A little beyond the page lifetime, so a payment made in the
// page's last minute is never voided under the customer.
const ABANDONED_PACK_MS = 25 * 3600_000;

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
  const summary = { dry_run: dryRun, checked: 0, credited: [], retried: [], downgraded: [], voided: [], cache_fixed: [], replayed: 0, errors: [] };
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

  // (1b) credit purchases whose webhook never arrived — our one-off packs and
  // Lago-portal top-ups alike. For a pack the credits are not even granted until
  // this runs, so this IS "money taken, credits never granted" for packs; for a
  // portal top-up Lago granted them but the request gate's shadow balance and
  // the purchased-credit bookkeeping still need doing. Every org with a Stripe
  // customer, not only paying orgs: a free org can buy a pack. Also voids pack
  // invoices left unpaid past the life of their payment page, so abandoned
  // pages do not pile up as open invoices on the customer's account.
  for (const row of await orgBillingService.listWithPaymentMethod()) {
    try {
      const paid = [
        ...(await listCreditPackInvoices(row.org_id, "succeeded")),
        ...(await listInvoices(row.org_id, { payment_status: "succeeded", invoice_type: "credit", per_page: 24 }))
      ];
      for (const invoice of paid) {
        if (new Date(invoice.created_at ?? invoice.issuing_date).getTime() < since) continue;
        if (invoice.status === "voided") continue;
        if (await billingEventService.hasCreditedInvoice(invoice.lago_id)) continue;
        summary.credited.push({ org_id: row.org_id, invoice: invoice.lago_id, number: invoice.number, kind: "credit_pack" });
        if (!dryRun) await processLagoEvent(syntheticPaidEvent(invoice));
      }

      const abandoned = (await listCreditPackInvoices(row.org_id, "pending")).filter(
        (inv) => inv.status !== "voided" && Date.now() - new Date(inv.created_at ?? inv.issuing_date).getTime() > ABANDONED_PACK_MS
      );
      for (const invoice of abandoned) {
        summary.voided.push({ org_id: row.org_id, invoice: invoice.lago_id, number: invoice.number });
        if (!dryRun)
          await voidInvoice(invoice.lago_id).catch((err) =>
            summary.errors.push({ org_id: row.org_id, step: "void_abandoned_pack", error: err.message })
          );
      }
      if (!dryRun && abandoned.length) {
        await orgBillingService.clearPendingPurchases(
          row.org_id,
          abandoned.map((inv) => inv.lago_id)
        );
      }
    } catch (err) {
      summary.errors.push({ org_id: row.org_id, step: "missed_credit_packs", error: err.message });
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
