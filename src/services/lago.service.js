import axios from "axios";

import client from "./cache.service.js";
import { REDIS_PREFIX } from "../cache_service/index.js";
import logger from "../logger.js";
import { DEFAULT_PLAN_SLUG, planCodeFor, planSlugForCode } from "../configs/billingPlans.js";
import billingPlanService from "../db_services/billingPlan.service.js";
import { redis_keys } from "../configs/constant.js";
import { unknown_error_handler_alert } from "./utils/utility.service.js";

const BILLING_API_URL = process.env.BILLING_API_URL;
const BILLING_API_KEY = process.env.BILLING_API_KEY;
const WALLET_RATE_AMOUNT = process.env.LAGO_CREDIT_RATE_USD;
const WALLET_CURRENCY = "USD";
const DEFAULT_GRANT_CREDITS = process.env.LAGO_SIGNUP_GRANT_CREDITS;

// The external_id we give a subscription WE create: the bare org_id.
//
// Only for creation. Never use it to address an EXISTING subscription — read
// the real id with resolveSubscriptionExternalId() instead. Three spellings are
// in the wild (`11643`, `sub-11643`, `sub_11643`) because earlier code guessed
// differently, and 4 of 6 subscriptions on the deployed Lago carry a `sub-`
// prefix.
//
// Guessing here is not a harmless miss: Lago's event ingestion is async and
// does NOT validate external_subscription_id at post time. It answers 200,
// parks the event, and rates it later against whatever subscription eventually
// owns that id. Org 74145 lost 345 credits to this — 43 events posted to
// `74145` while the live subscription was `sub-74145` sat parked for 50
// minutes, then landed in one lump the instant a re-provision created a
// subscription actually called `74145`, putting a brand-new wallet 345 credits
// in the red. Nothing was rejected, so nothing reached failed_billing_debits
// and no alert fired; the Redis shadow balance never saw those credits either,
// which is what let the -100 overdraft floor be enforced against a starting
// figure that was 345 too high.
export const subscriptionExternalId = (org_id) => String(org_id);

// Lago sits in front of user-visible work (a debit runs right after a chatbot
// reply is delivered), and axios has NO default timeout — a hung Lago would hang
// the caller forever. Python's Lago client caps itself at 3s for the same reason
// (src/services/billing/lago_service.py). Fail fast; the debit is stored in
// failed_billing_debits and replayed.
const BILLING_TIMEOUT_MS = Number(process.env.BILLING_API_TIMEOUT_MS || 5000);

// Wallet debits run in the queue consumer, after the reply is already delivered,
// so nobody waits on them — and a timed-out debit is the one failure we cannot
// replay automatically (Lago may or may not have ingested it, so it is stored
// as "ambiguous"). Give them far more room than the user-facing calls.
const BILLING_DEBIT_TIMEOUT_MS = 20000;

const billingHeaders = () => ({
  Authorization: `Bearer ${BILLING_API_KEY}`,
  "Content-Type": "application/json"
});

// Axios config every Lago call uses, so none of them can hang without a timeout.
const billingRequestConfig = (timeout = BILLING_TIMEOUT_MS) => ({ headers: billingHeaders(), timeout });

// Turn a Lago HTTP error into an Error that carries the status and body.
const lagoRequest = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    if (err?.response) {
      const { status, data } = err.response;
      const lagoError = new Error(`Lago API error ${status}: ${JSON.stringify(data)}`);
      lagoError.response = err.response;
      lagoError.lagoStatus = status;
      lagoError.lagoData = data;
      throw lagoError;
    }
    throw err;
  }
};

// Create (or upsert) the Lago customer for an org.
export const createCustomer = async (org_id, { email = null } = {}) =>
  lagoRequest(() =>
    axios
      .post(
        `${BILLING_API_URL}/customers`,
        { customer: { external_id: String(org_id), name: String(org_id), ...(email ? { email } : {}) } },
        billingRequestConfig()
      )
      .then((r) => r.data)
  );

// The Lago customer as Lago holds it, or null when it does not exist.
export const getCustomer = async (org_id) =>
  lagoRequest(() =>
    axios
      .get(`${BILLING_API_URL}/customers/${encodeURIComponent(String(org_id))}`, billingRequestConfig())
      .then((r) => r.data?.customer ?? null)
      .catch((err) => {
        if (err?.response?.status === 404) return null;
        throw err;
      })
  );

// --- Stripe through Lago ------------------------------------------------------
// Lago owns the Stripe customer, the card and every charge. Our side only tells
// Lago WHICH payment-provider connection to use for an org (the one configured
// in Lago's Integrations page), then asks Lago for the hosted pages.
const STRIPE_PROVIDER_CODE = () => process.env.LAGO_STRIPE_PROVIDER_CODE || "";

// Attach the org's Lago customer to the Stripe connection. `sync: true` makes
// Lago create the Stripe customer before answering, so a checkout URL can be
// requested right after. POST /customers is Lago's upsert (the deployed Lago
// has no PUT /customers/:id route — it answers the generic 404
// `resource_not_found`, verified live 2026-09-15), so this is safe to call on
// every checkout: only the fields sent are touched.
export const setCustomerPaymentProvider = async (org_id, { email = null } = {}) => {
  const payment_provider_code = STRIPE_PROVIDER_CODE();
  if (!payment_provider_code) throw new Error("LAGO_STRIPE_PROVIDER_CODE is not set — cannot attach a payment provider");
  return lagoRequest(() =>
    axios
      .post(
        `${BILLING_API_URL}/customers`,
        {
          customer: {
            external_id: String(org_id),
            name: String(org_id),
            ...(email ? { email } : {}),
            billing_configuration: {
              payment_provider: "stripe",
              payment_provider_code,
              sync: true,
              sync_with_provider: true,
              provider_payment_methods: ["card"]
            }
          }
        },
        billingRequestConfig()
      )
      .then((r) => r.data?.customer ?? r.data)
  );
};

// Stripe Checkout in SETUP mode: saves a card on the Lago-owned Stripe customer,
// charges nothing. Lago's Stripe connection decides where Stripe redirects after.
export const getCheckoutUrl = async (org_id) =>
  lagoRequest(() =>
    axios
      .post(`${BILLING_API_URL}/customers/${encodeURIComponent(String(org_id))}/checkout_url`, {}, billingRequestConfig())
      .then((r) => r.data?.customer?.checkout_url ?? null)
  );

// The Lago plan itself — the only place the subscription fee (amount, currency,
// interval) lives. Cached briefly so the plans page does not hit Lago per view.
const LAGO_PLAN_CACHE_TTL = 10 * 60;
export const getLagoPlan = async (plan_slug) => {
  const plan_code = planCodeFor(plan_slug);
  const key = `${REDIS_PREFIX}${redis_keys.billing_lago_plan_}${plan_code}`;
  const cached = await client.get(key).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      /* fall through to Lago */
    }
  }
  const plan = await lagoRequest(() =>
    axios.get(`${BILLING_API_URL}/plans/${encodeURIComponent(plan_code)}`, billingRequestConfig()).then((r) => r.data?.plan ?? null)
  );
  if (!plan) return null;
  const slim = {
    code: plan.code,
    name: plan.name ?? null,
    amount_cents: Number(plan.amount_cents) || 0,
    amount_currency: plan.amount_currency ?? WALLET_CURRENCY,
    interval: plan.interval ?? null,
    pay_in_advance: Boolean(plan.pay_in_advance)
  };
  await client.set(key, JSON.stringify(slim), { EX: LAGO_PLAN_CACHE_TTL }).catch(() => {});
  return slim;
};

// Lago's hosted customer portal (invoices, usage, credits). Token lives 12h.
export const getPortalUrl = async (org_id) =>
  lagoRequest(() =>
    axios
      .get(`${BILLING_API_URL}/customers/${encodeURIComponent(String(org_id))}/portal_url`, billingRequestConfig())
      .then((r) => r.data?.customer?.portal_url ?? null)
  );

export const getInvoice = async (lago_id) =>
  lagoRequest(() =>
    axios.get(`${BILLING_API_URL}/invoices/${encodeURIComponent(String(lago_id))}`, billingRequestConfig()).then((r) => r.data?.invoice ?? null)
  );

// The org's invoices, newest first. Filters are passed straight to Lago.
export const listInvoices = async (org_id, { payment_status, status, invoice_type, per_page = 50, page = 1 } = {}) =>
  lagoRequest(() =>
    axios
      .get(`${BILLING_API_URL}/invoices`, {
        ...billingRequestConfig(),
        params: {
          external_customer_id: String(org_id),
          per_page,
          page,
          ...(payment_status ? { payment_status } : {}),
          ...(status ? { status } : {}),
          ...(invoice_type ? { invoice_type } : {})
        }
      })
      .then((r) => r.data?.invoices ?? [])
  );

// Ask Lago to charge the invoice again through the payment provider. The
// outcome arrives as a webhook (payment_status_updated / payment_failure).
export const retryInvoicePayment = async (lago_id) =>
  lagoRequest(() =>
    axios
      .post(`${BILLING_API_URL}/invoices/${encodeURIComponent(String(lago_id))}/retry_payment`, {}, billingRequestConfig())
      .then((r) => r.data?.invoice ?? r.data)
  );

export const voidInvoice = async (lago_id) =>
  lagoRequest(() =>
    axios
      .post(`${BILLING_API_URL}/invoices/${encodeURIComponent(String(lago_id))}/void`, {}, billingRequestConfig())
      .then((r) => r.data?.invoice ?? r.data)
  );

// Terminate a subscription NOW. No credit note and no closing invoice: this is
// only used to end unpaid Pro access, where charging or refunding would be wrong.
export const terminateSubscription = async (external_id, { status = null } = {}) =>
  lagoRequest(() =>
    axios
      .delete(`${BILLING_API_URL}/subscriptions/${encodeURIComponent(String(external_id))}`, {
        ...billingRequestConfig(),
        params: { on_termination_credit_note: "skip", on_termination_invoice: "skip", ...(status ? { status } : {}) }
      })
      .then((r) => r.data?.subscription ?? r.data)
  );

// Subscriptions on a plan, one page at a time (for the reconcile sweep).
export const listSubscriptionsByPlan = async (plan_slug, { status = "active", per_page = 100, page = 1 } = {}) =>
  lagoRequest(() =>
    axios
      .get(`${BILLING_API_URL}/subscriptions`, {
        ...billingRequestConfig(),
        params: { plan_code: planCodeFor(plan_slug), "status[]": status, per_page, page }
      })
      .then((r) => ({ subscriptions: r.data?.subscriptions ?? [], meta: r.data?.meta ?? {} }))
  );

// POST /subscriptions is how Lago does BOTH "create" and "change plan": the
// same external_id with a different plan_code rotates the subscription in
// place, copying external_id onto the new row (verified live — external_id
// survived a free->paid switch). Same plan_code is a genuine no-op.
//
// billing_time is only passed when creating: on a plan change Lago inherits it
// from the current subscription. `name` is always passed — the upgrade path
// blanks it if omitted.
//
// external_id: rotating in place depends on posting the id the subscription
// ALREADY has, so the change path must pass the one it read from Lago. Posting
// the canonical bare org_id to an org whose subscription is `sub-<org_id>` does
// not rotate anything — it mints a SECOND active subscription alongside the
// first, and getSubscription's `subs.find(active)` then picks between them by
// luck. Only a genuinely new subscription gets the canonical id.
//
// billing_time (creation only; Lago IGNORES it on a plan change and keeps the
// current subscription's — verified live 2026-09-15): "calendar" bills on the
// 1st with the first period prorated; "anniversary" bills the full amount on
// the start date and renews on that day. Free subscriptions use calendar; the
// paid one is created fresh with anniversary so the customer pays a flat $20.
export const createSubscription = async (org_id, plan_slug = DEFAULT_PLAN_SLUG, { isChange = false, external_id, billing_time = "calendar" } = {}) =>
  lagoRequest(() => {
    const subscription = {
      external_customer_id: String(org_id),
      plan_code: planCodeFor(plan_slug),
      external_id: external_id || subscriptionExternalId(org_id),
      name: `subscription-${org_id}`
    };
    if (!isChange) subscription.billing_time = billing_time;
    return axios.post(`${BILLING_API_URL}/subscriptions`, { subscription }, billingRequestConfig()).then((r) => r.data);
  });

// The org's active subscription as Lago sees it, or null.
//
// The status filter is NOT optional. Lago's GET /subscriptions returns only
// ACTIVE subscriptions when no status is given, so a downgrade Lago has parked
// for the end of the period — which is exactly what "cancel" creates — is
// invisible without asking for it. Verified live 2026-09-17: the same query
// returned 1 subscription bare and 2 with `status[]=active&status[]=pending`.
// Every caller that reasons about `pending` (cancel, resume, the deferred
// branch of changeOrgPlan, the "already cancelling" guard on subscribe) reads
// from here, so leaving it off silently breaks all of them.
export const getSubscription = async (org_id, { timeout } = {}) => {
  const response = await lagoRequest(() =>
    axios.get(`${BILLING_API_URL}/subscriptions`, {
      ...billingRequestConfig(timeout),
      // axios turns an array value into status[]=active&status[]=pending.
      params: { external_customer_id: String(org_id), status: ["active", "pending"] }
    })
  );
  const subs = response?.data?.subscriptions || [];
  const active = subs.find((sub) => sub.status === "active") || null;
  const pending = subs.find((sub) => sub.status === "pending") || null;
  if (!active) return pending ? { pending_only: true, pending } : null;
  return {
    lago_id: active.lago_id ?? null,
    external_id: active.external_id,
    plan_code: active.plan_code,
    plan_slug: planSlugForCode(active.plan_code),
    // The subscription's own fee: 0 for an org comped with a plan override.
    plan_amount_cents: active.plan_amount_cents ?? null,
    status: active.status,
    // Period bounds, when Lago exposes them (newer versions do). Used for
    // "cancels on <date>" in the UI; null is handled everywhere.
    current_period_start: active.current_billing_period_started_at ?? null,
    current_period_end: active.current_billing_period_ending_at ?? null,
    ending_at: active.ending_at ?? null,
    pending: pending
      ? {
          external_id: pending.external_id,
          plan_code: pending.plan_code,
          plan_slug: planSlugForCode(pending.plan_code),
          status: pending.status,
          subscription_at: pending.subscription_at ?? null
        }
      : null
  };
};

// --- addressing an existing subscription ----------------------------------
// The external_id Lago actually holds for this org's ACTIVE subscription, or
// null when it has none. This is the id every charge must be addressed to.
//
// Cached in Redis because it sits on the debit path (one Lago GET per org per
// day instead of per charge) and changes only when a subscription is created or
// rotated — both of which drop the key. A cache miss with Lago unreachable
// returns null rather than falling back to a guess: a debit that fails loudly
// is stored in failed_billing_debits and replayed, while a debit addressed to a
// guessed id is accepted, parked, and silently mis-rated later.
const SUB_EXTERNAL_ID_TTL = 86400;

const subExternalIdKey = (org_id) => `${REDIS_PREFIX}${redis_keys.billing_sub_external_id_}${org_id}`;

export const resolveSubscriptionExternalId = async (org_id, { timeout } = {}) => {
  if (client.isReady) {
    const cached = await client.get(subExternalIdKey(org_id)).catch(() => null);
    if (cached) return cached;
  }

  // Deliberately NOT caught: a Lago failure here must reach walletDebit's retry
  // and then failed_billing_debits, not be flattened into "no subscription".
  const subscription = await getSubscription(org_id, { timeout });
  const external_id = subscription?.pending_only ? null : subscription?.external_id || null;
  if (!external_id) return null;

  if (external_id !== subscriptionExternalId(org_id)) {
    // Not an error — just the interim spellings still in the wild. Logged so
    // the size of the `sub-*` population is visible without querying Lago.
    logger.info(`[lago] org ${org_id} subscription external_id is '${external_id}', not the canonical '${org_id}'`);
  }
  if (client.isReady) {
    await client.set(subExternalIdKey(org_id), external_id, { EX: SUB_EXTERNAL_ID_TTL }).catch(() => {});
  }
  return external_id;
};

// Drop the cached id. Called wherever a subscription is created or rotated —
// a stale id here would send charges to a subscription that no longer exists.
const invalidateSubscriptionExternalId = async (org_id) => {
  if (!client.isReady) return;
  await client.del(subExternalIdKey(org_id)).catch(() => {});
};

// How many credits a new wallet is granted: the plan's own figure if it has
// one, otherwise the env default.
const resolveGrantCredits = async (plan_slug) => {
  try {
    const plan = await billingPlanService.getPlan(plan_slug);
    const fromPlan = plan?.credit_grant;
    if (fromPlan != null && Number.isFinite(Number(fromPlan)) && Number(fromPlan) >= 0) {
      return String(fromPlan);
    }
  } catch (err) {
    logger.error(`[lago] could not read credit_grant for plan '${plan_slug}': ${err.message}`);
  }
  if (DEFAULT_GRANT_CREDITS == null || String(DEFAULT_GRANT_CREDITS).trim() === "") {
    logger.error(
      "[lago] LAGO_SIGNUP_GRANT_CREDITS is not set and the plan carries no credit_grant — " +
        "granting 0 credits. New orgs will have an empty wallet until this is configured."
    );
    return "0";
  }
  return String(DEFAULT_GRANT_CREDITS);
};

// Create the org's wallet with its one-time signup grant. No expiration_at: in Lago that voids the whole wallet, paid credits included.
export const createWallet = async (org_id, plan_slug = DEFAULT_PLAN_SLUG) => {
  if (!WALLET_RATE_AMOUNT) {
    throw new Error("LAGO_CREDIT_RATE_USD is not set — refusing to create a wallet with an undefined credit rate");
  }
  const granted_credits = await resolveGrantCredits(plan_slug);
  logger.info(`[lago] creating wallet for org ${org_id} on plan '${plan_slug}' with ${granted_credits} credits`);
  const wallet = {
    external_customer_id: org_id,
    name: `wallet-${org_id}`,
    currency: WALLET_CURRENCY,
    rate_amount: WALLET_RATE_AMOUNT,
    granted_credits,
    ...WALLET_INVARIANTS
  };
  const response = await lagoRequest(() => axios.post(`${BILLING_API_URL}/wallets`, { wallet }, billingRequestConfig()));
  return response.data;
};

// --- wallet invariants --------------------------------------------------------
// Two Lago defaults are wrong for us, and each one hands out credits nobody
// paid for. Both are wallet settings, so they are applied at creation and
// repaired on any wallet that predates them.
//
// 1. applies_to.fee_types — an unrestricted wallet settles EVERY invoice of the
//    customer, including the $20 Pro subscription fee, so the fee is paid from
//    the org's own credits, the card is never charged, and the paid-invoice
//    webhook would then refill the credits. Verified live 2026-09-15: a $10.67
//    fee consumed 4,268 credits. "charge" = usage charges only.
//
// 2. invoice_requires_successful_payment — false by default, which means a
//    prepaid top-up (the wallet section of Lago's customer portal) grants the
//    credits IMMEDIATELY and merely issues an invoice. If that invoice is never
//    paid the customer keeps the credits. Verified live 2026-09-16 on org
//    74145: invoices of $0.25 and $12.50 sat at payment_status "pending" for
//    days while 100 and 5,000 credits had already been granted. True makes Lago
//    hold the credits until the payment actually succeeds. It does NOT affect
//    granted_credits — our monthly reset still settles instantly (verified).
const WALLET_APPLIES_TO = { fee_types: ["charge"] };

const WALLET_INVARIANTS = { applies_to: WALLET_APPLIES_TO, invoice_requires_successful_payment: true };

const walletIsSound = (wallet) => {
  const types = wallet?.applies_to?.fee_types;
  const chargesOnly = Array.isArray(types) && types.length === 1 && types[0] === "charge";
  return chargesOnly && wallet?.invoice_requires_successful_payment === true;
};

// Enforce both invariants on EVERY active wallet of the org. All of them, not
// just the one getWallet reports from: an org with a duplicate wallet (see
// getWallet) would otherwise leave the second one free to settle the
// subscription fee or to hand out unpaid credits.
// Returns { updated, wallet_ids } or null when the org has no wallet.
export const ensureWalletInvariants = async (org_id) => {
  const active = await fetchActiveWallets(org_id);
  if (!active.length) return null;
  const unsound = active.filter((w) => !walletIsSound(w));
  if (!unsound.length) return { updated: false, wallet_ids: active.map((w) => w.lago_id) };
  for (const wallet of unsound) {
    await lagoRequest(() =>
      axios.put(`${BILLING_API_URL}/wallets/${encodeURIComponent(wallet.lago_id)}`, { wallet: WALLET_INVARIANTS }, billingRequestConfig())
    );
    logger.info(`[lago] org ${org_id}: wallet ${wallet.lago_id} set to usage-charges-only and payment-before-credits`);
  }
  await invalidateWalletCache(org_id);
  return { updated: true, wallet_ids: unsound.map((w) => w.lago_id) };
};

// Drop the cached plan so the next read comes from Lago. Exported: the Lago
// webhook handlers call it after every subscription change Lago reports.
export const invalidatePlanCache = async (org_id) => {
  if (!client.isReady) return;
  await client.del(`${REDIS_PREFIX}${redis_keys.org_billing_plan_}${org_id}`).catch(() => {});
};

// Provision an org end to end: customer, subscription and wallet, each only if missing.
export const ensureOrgSubscribed = async (org_id, { plan_slug = DEFAULT_PLAN_SLUG } = {}) => {
  const isAlreadyExists = (err) => {
    const status = err?.response?.status;
    return status === 422 || status === 409;
  };

  let customer;
  try {
    customer = await createCustomer(org_id);
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    customer = { skipped: true, reason: "customer already exists" };
  }

  // Read before write: re-POSTing a plan here would knock every paid org back to free.
  let subscription;
  const existingSubscription = await getSubscription(org_id);
  if (existingSubscription && !existingSubscription.pending_only) {
    subscription = {
      skipped: true,
      reason: "subscription already exists",
      plan_code: existingSubscription.plan_code,
      plan_slug: existingSubscription.plan_slug
    };
  } else {
    try {
      subscription = await createSubscription(org_id, plan_slug);
      await invalidateSubscriptionExternalId(org_id);
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
      subscription = { skipped: true, reason: "subscription already exists" };
      // "Already exists" means Lago holds an id we have not seen — drop ours.
      await invalidateSubscriptionExternalId(org_id);
    }
  }

  // Wallets are not idempotent in Lago — a second one would carry a second grant.
  let wallet = null;
  const existingWallet = await getWallet(org_id);
  if (existingWallet) {
    wallet = { skipped: true, reason: "active wallet already exists" };
    // Older wallets predate the charges-only rule; fix them as we pass.
    await ensureWalletInvariants(org_id).catch((err) => logger.error(`[lago] org ${org_id}: could not restrict wallet: ${err.message}`));
  } else {
    try {
      wallet = await createWallet(org_id, plan_slug);
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
      wallet = { skipped: true, reason: "wallet already exists" };
    }
  }

  const plan = subscription?.plan_slug || existingSubscription?.plan_slug || DEFAULT_PLAN_SLUG;
  await invalidatePlanCache(org_id);

  return { customer, subscription, wallet, plan };
};

// The only function allowed to move an org between plans: Lago first, then the cache.
//
// Lago applies an UPGRADE at once and DEFERS a downgrade to the end of the
// current period (a pending subscription appears). Three ways to call this:
//   default            — the change must be live when we return, else throw
//                        (unchanged behaviour; what the admin route relies on).
//   allowDeferred      — a downgrade Lago parks for period end is a success:
//                        returns { deferred: true, ends_at }. Used by "cancel".
//   immediate          — terminate the current subscription (no credit note, no
//                        closing invoice) and create a fresh one on the target
//                        plan, optionally with its own billingTime. Used to end
//                        unpaid Pro, and to START Pro on anniversary billing
//                        (a rotate-in-place would inherit the free plan's
//                        calendar timing and prorate the first invoice).
export const changeOrgPlan = async (
  org_id,
  plan_slug,
  { actor = "", reason = "", allowDeferred = false, immediate = false, billingTime = "calendar" } = {}
) => {
  const target_code = planCodeFor(plan_slug);

  if (!(await claimPlanChange(org_id))) {
    throw new Error(`a plan change for org ${org_id} is already in progress`);
  }
  try {
    const current = await getSubscription(org_id);
    if (!current || current.pending_only) {
      throw new Error(`org ${org_id} has no active Lago subscription — provision it first`);
    }

    const previous_plan = current.plan_slug;
    const who = `${actor || "unknown"}${reason ? ` (${reason})` : ""}`;

    // Moving onto a plan with a fee: the wallet must not be allowed to pay it.
    // Done before the POST so the very first invoice already sees the rule.
    if (plan_slug !== DEFAULT_PLAN_SLUG) {
      await ensureWalletInvariants(org_id).catch((err) => {
        throw new Error(`org ${org_id}: refusing to move to '${plan_slug}' — wallet could not be restricted to usage charges (${err.message})`);
      });
    }

    if (current.plan_code === target_code) {
      // Lago already holds the plan. If a downgrade is parked, re-assigning the
      // current plan is how Lago drops it ("resume"); a POST is needed for that.
      if (current.pending && current.pending.plan_code !== target_code) {
        await createSubscription(org_id, plan_slug, { isChange: true, external_id: current.external_id });
        const after = await getSubscription(org_id);
        const stillPending = after?.pending && after.pending.plan_code !== target_code;
        if (stillPending) {
          // Lago kept the pending row; remove it explicitly.
          await terminateSubscription(after.pending.external_id, { status: "pending" });
        }
        await invalidatePlanCache(org_id);
        logger.info(`[lago] org ${org_id} pending change to '${current.pending.plan_slug}' cancelled by ${who}`);
        return { changed: false, deferred: false, resumed: true, plan: plan_slug, previous_plan, plan_code: target_code };
      }
      await invalidatePlanCache(org_id);
      return { changed: false, deferred: false, plan: plan_slug, previous_plan, plan_code: target_code };
    }

    if (immediate) {
      // Terminate, then create. Same external_id when Lago lets us reuse it,
      // otherwise a suffixed one — walletDebit reads the real id, never guesses.
      await terminateSubscription(current.external_id);
      try {
        await createSubscription(org_id, plan_slug, { external_id: current.external_id, billing_time: billingTime });
      } catch (err) {
        const status = err?.response?.status ?? err?.lagoStatus;
        if (status !== 422 && status !== 409) throw err;
        await createSubscription(org_id, plan_slug, {
          external_id: `${current.external_id}-r${Math.floor(Date.now() / 1000)}`,
          billing_time: billingTime
        });
      }
      const after = await getSubscription(org_id);
      if (!after || after.pending_only || after.plan_code !== target_code) {
        throw new Error(`Lago did not activate plan '${plan_slug}' for org ${org_id} after terminating '${current.external_id}'`);
      }
      await invalidatePlanCache(org_id);
      await invalidateSubscriptionExternalId(org_id);
      logger.info(`[lago] org ${org_id} moved ${previous_plan} -> ${plan_slug} IMMEDIATELY (${billingTime} billing) by ${who}`);
      return { changed: true, deferred: false, immediate: true, billing_time: billingTime, plan: plan_slug, previous_plan, plan_code: target_code };
    }

    // Rotate the subscription the org ACTUALLY has, whatever it is spelled.
    await createSubscription(org_id, plan_slug, { isChange: true, external_id: current.external_id });

    // Read back rather than trusting the POST: a deferred change stays pending in Lago.
    const after = await getSubscription(org_id);
    if (!after || after.plan_code !== target_code) {
      const pendingMatches = after?.pending?.plan_code === target_code;
      if (allowDeferred && pendingMatches) {
        await invalidatePlanCache(org_id);
        logger.info(`[lago] org ${org_id} change ${previous_plan} -> ${plan_slug} deferred to period end by ${who}`);
        return {
          changed: false,
          deferred: true,
          plan: previous_plan,
          previous_plan,
          plan_code: current.plan_code,
          target_plan: plan_slug,
          ends_at: after?.current_period_end ?? after?.pending?.subscription_at ?? null
        };
      }
      const pendingCode = after?.pending?.plan_code || after?.pending_only;
      throw new Error(
        `Lago did not activate plan '${plan_slug}' for org ${org_id} — ` +
          `still on '${after?.plan_code}'${pendingCode ? `, change is pending` : ""}. Our records are unchanged.`
      );
    }

    await invalidatePlanCache(org_id);
    // A rotation keeps the external_id, but drop the cache anyway: it costs one
    // Lago GET and it is the difference between "charges follow the org" and
    // "charges go to a subscription that was just replaced".
    await invalidateSubscriptionExternalId(org_id);
    logger.info(`[lago] org ${org_id} moved ${previous_plan} -> ${plan_slug} by ${who}`);
    return { changed: true, deferred: false, plan: plan_slug, previous_plan, plan_code: target_code };
  } finally {
    await releasePlanChange(org_id);
  }
};

// The org's plan slug, straight from Lago.
export const getOrgPlanSlug = async (org_id) => {
  const subscription = await getSubscription(org_id).catch(() => null);
  return subscription?.plan_slug || DEFAULT_PLAN_SLUG;
};

// Read-only drift check between the Lago plan and the Redis cache of it.
export const reconcileOrgPlan = async (org_id) => {
  const subscription = await getSubscription(org_id).catch(() => null);
  let redis_plan = null;
  if (client.isReady) {
    redis_plan = await client.get(`${REDIS_PREFIX}${redis_keys.org_billing_plan_}${org_id}`).catch(() => null);
  }
  const lago_plan = subscription?.plan_slug ?? null;
  const drift = redis_plan !== null && redis_plan !== lago_plan;
  return {
    org_id: String(org_id),
    lago_plan_code: subscription?.plan_code ?? null,
    lago_plan,
    redis_plan,
    pending: subscription?.pending ?? null,
    drift
  };
};

// The org's active wallet exactly as Lago returns it, or null. Internal: the
// public shape is getWallet's.
const fetchActiveWallets = async (org_id) => {
  const response = await lagoRequest(() =>
    axios.get(`${BILLING_API_URL}/wallets`, {
      ...billingRequestConfig(),
      params: { external_customer_id: org_id }
    })
  );
  const wallets = (response?.data?.wallets || []).filter((w) => w.status === "active");
  // Oldest first, so the choice below is reproducible instead of "whatever Lago
  // listed first". Lago returns newest first, which is how org 20678 went a
  // month reading a pristine wallet while its usage piled onto another one.
  return wallets.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
};

const fetchActiveWallet = async (org_id) => (await fetchActiveWallets(org_id))[0] ?? null;

const sumCredits = (wallets, field) => wallets.reduce((total, w) => total + (Number(w?.[field]) || 0), 0);

// The org's active wallet from Lago, or null.
//
// An org should have exactly one. When it has more, Lago charges usage to one of
// them and returns the other first, so reading a single wallet reports a balance
// that never moves while the real one drains — org 20678 sat at a frozen 2440
// while its usage ran to -284 on a second wallet, and the admission gate, which
// seeds from this figure, never refused a request. So the credit figures below
// are the SUM across every active wallet, i.e. the org's true net position,
// whichever wallet Lago happens to draw from. Identity fields still come from
// the oldest wallet, and the duplicate is reported and alerted rather than
// silently averaged away.
export const getWallet = async (org_id) => {
  const active = await fetchActiveWallets(org_id);
  if (!active.length) return null;
  const primary = active[0];
  if (active.length > 1) {
    const ids = active.map((w) => w.lago_id).join(", ");
    logger.error(`[lago] org ${org_id} has ${active.length} active wallets (${ids}) — balances summed; terminate the extras`);
    unknown_error_handler_alert("lagoDuplicateWallet", null, `org ${org_id} has ${active.length} active wallets: ${ids}`);
  }
  return {
    credits_balance: String(sumCredits(active, "credits_balance")),
    balance_cents: sumCredits(active, "balance_cents"),
    currency: primary.currency,
    rate_amount: primary.rate_amount,
    ongoing_balance_cents: sumCredits(active, "ongoing_balance_cents"),
    expiration_at: primary.expiration_at,
    credits_ongoing_balance: String(sumCredits(active, "credits_ongoing_balance")),
    // Usage consumed but not yet invoiced. credits_balance minus this is the
    // spendable amount the monthly top-up computes against, and unlike
    // credits_ongoing_balance it does not depend on Lago's asynchronous refresh
    // job (a brand-new wallet reports ongoing 0.0 while credits_balance already
    // holds the signup grant).
    credits_ongoing_usage_balance: String(sumCredits(active, "credits_ongoing_usage_balance")),
    active_wallet_count: active.length,
    wallet_ids: active.map((w) => w.lago_id)
  };
};

const TOPUP_APPLIED_TTL = 86400;
const WALLET_CACHE_TTL = 60;

const walletCacheKey = (org_id) => `${REDIS_PREFIX}${redis_keys.billing_wallet_}${org_id}`;

// Drop the cached wallet so the next read goes back to Lago.
const invalidateWalletCache = async (org_id) => {
  if (!client.isReady) return;
  await client.del(walletCacheKey(org_id)).catch(() => {});
};

// The org's wallet from Redis, falling back to Lago (and caching it) on a miss.
export const getWalletCached = async (org_id) => {
  const key = walletCacheKey(org_id);
  if (client.isReady) {
    try {
      const cached = await client.get(key);
      if (cached) return JSON.parse(cached);
    } catch {
      // a bad or unreachable cache entry just means we ask Lago
    }
  }

  const wallet = await getWallet(String(org_id));
  if (wallet && client.isReady) {
    await client.set(key, JSON.stringify(wallet), { EX: WALLET_CACHE_TTL }).catch(() => {});
  }
  return wallet;
};

const topupClaimKey = (reference_id) => `${REDIS_PREFIX}${redis_keys.billing_topup_applied_}${reference_id}`;

const PLAN_CHANGE_LOCK_TTL = 30;

// Per-org lock so two concurrent plan changes cannot race Lago.
const claimPlanChange = async (org_id) => {
  if (!client.isReady) return true; // fail open: no lock without Redis
  const claimed = await client.set(`${REDIS_PREFIX}${redis_keys.billing_plan_lock_}${org_id}`, "1", {
    NX: true,
    EX: PLAN_CHANGE_LOCK_TTL
  });
  return claimed !== null;
};

const releasePlanChange = async (org_id) => {
  if (!client.isReady) return;
  await client.del(`${REDIS_PREFIX}${redis_keys.billing_plan_lock_}${org_id}`).catch(() => {});
};

// Claim a top-up reference_id so the same payment cannot be credited twice.
const claimTopupReference = async (reference_id) => {
  if (!reference_id || !client.isReady) return true;
  const claimed = await client.set(topupClaimKey(reference_id), "1", {
    NX: true,
    EX: TOPUP_APPLIED_TTL
  });
  return claimed !== null;
};

const releaseTopupClaim = async (reference_id) => {
  if (!reference_id || !client.isReady) return;
  await client.del(topupClaimKey(reference_id)).catch(() => {});
};

// --- credit packs as ONE-OFF invoices -----------------------------------------
// A wallet top-up (paid_credits) cannot be sold on a Stripe page for a customer
// who has a card on file: Lago charges that card off session the moment it
// raises the invoice, and the flag that would stop it (payment_method_type
// "manual") is stored but ignored until Lago v1.50 — the dev instance is
// v1.42.0. A ONE-OFF invoice with `skip_psp` is different: Lago raises it and
// does NOT charge, so it stays unpaid and a hosted Stripe page can be issued for
// it. Verified live 2026-09-17 on an org with a saved card: no payment attempted
// after 12s, and payment_url returned a Checkout session. Revenue still lands in
// Lago as a paid invoice; the credits are then granted to the wallet by us once
// the page is paid. The wallet is restricted to usage charges (see
// ensureWalletInvariants), so it cannot pay for its own top-up.
export const CREDIT_PACK_ADD_ON_CODE = "credit_pack";

// The add-on every credit-pack invoice bills against. Idempotent: Lago answers
// 422 for a code that exists. The amount here is only a default; each invoice
// sets its own unit price.
export const ensureCreditPackAddOn = async () =>
  lagoRequest(() =>
    axios
      .post(
        `${BILLING_API_URL}/add_ons`,
        {
          add_on: {
            name: "Credit pack",
            code: CREDIT_PACK_ADD_ON_CODE,
            amount_cents: 1000,
            amount_currency: WALLET_CURRENCY,
            description: "Extra credits, priced per pack at invoice time"
          }
        },
        billingRequestConfig()
      )
      .then((r) => r.data?.add_on ?? true)
      .catch((err) => {
        if (err?.response?.status === 422) return true;
        throw err;
      })
  );

// Raise the invoice for one pack. skip_psp is what keeps the card unmoved; the
// metadata is how the paid-invoice handler later knows how many credits to
// grant, so it does not have to divide dollars by a rate that might have moved.
export const createCreditPackInvoice = async (org_id, { usd, credits, actor = "" }) => {
  const cents = Math.round(Number(usd) * 100);
  const invoice = await lagoRequest(() =>
    axios
      .post(
        `${BILLING_API_URL}/invoices`,
        {
          invoice: {
            external_customer_id: String(org_id),
            currency: WALLET_CURRENCY,
            skip_psp: true,
            fees: [
              {
                add_on_code: CREDIT_PACK_ADD_ON_CODE,
                units: 1,
                unit_amount_cents: cents,
                description: `${credits} credits`,
                invoice_display_name: `Credit pack: ${credits} credits`
              }
            ]
          }
        },
        billingRequestConfig()
      )
      .then((r) => r.data?.invoice ?? null)
  );
  if (!invoice?.lago_id) throw new Error(`Lago did not return the credit-pack invoice for org ${org_id}`);
  await lagoRequest(() =>
    axios.put(
      `${BILLING_API_URL}/invoices/${encodeURIComponent(invoice.lago_id)}`,
      {
        invoice: {
          metadata: [
            { key: "source", value: "credit-pack" },
            { key: "credits", value: String(credits) },
            { key: "usd", value: String(usd) },
            { key: "org_id", value: String(org_id) },
            { key: "actor", value: String(actor || "") }
          ]
        }
      },
      billingRequestConfig()
    )
  ).catch((err) => logger.error(`[lago] org ${org_id}: credit-pack invoice ${invoice.lago_id} raised but metadata not set: ${err.message}`));
  return invoice;
};

// The hosted Stripe Checkout (payment mode) for an unpaid invoice. Lago reuses
// a non-expired session, so asking again returns the same page for 24h.
export const invoicePaymentUrl = async (lago_id) =>
  lagoRequest(() =>
    axios
      .post(`${BILLING_API_URL}/invoices/${encodeURIComponent(String(lago_id))}/payment_url`, {}, billingRequestConfig())
      .then((r) => r.data?.invoice_payment_details?.payment_url ?? null)
  );

// Add credits to the org's wallet. granted_credits, not paid_credits: payment is collected outside Lago.
export const walletCredit = async (org_id, credits, metadata = {}) =>
  lagoRequest(async () => {
    const wallet_id = (await fetchActiveWallet(org_id))?.lago_id ?? null;
    if (!wallet_id) throw new Error(`no active wallet found for org_id=${org_id}`);

    const wallet_transaction = {
      wallet_id,
      granted_credits: String(credits),
      metadata: Object.entries(metadata).map(([key, value]) => ({ key, value: String(value) }))
    };
    const response = await axios.post(`${BILLING_API_URL}/wallet_transactions`, { wallet_transaction }, billingRequestConfig());
    return response.data;
  });

// Overwrite the gate's shadow balance with Lago's figure. Admin/top-up paths only — never a hot path.
export const syncWalletBalanceToRedis = async (org_id) => {
  const wallet = await getWallet(String(org_id));
  await invalidateWalletCache(org_id);
  if (!wallet) return null;

  const balance = String(wallet.credits_ongoing_balance ?? wallet.credits_balance ?? "0");
  if (!client.isReady) return balance;

  await client.set(`${REDIS_PREFIX}${redis_keys.billing_credit_balance_}{${org_id}}`, balance);
  return balance;
};

// What the request gate currently believes the org holds — the shadow balance
// syncWalletBalanceToRedis writes. null when there is no key yet (the next
// request seeds it from Lago) or Redis is down. Read-only; for admin views.
export const getShadowBalance = async (org_id) => {
  if (!client.isReady) return null;
  const value = await client.get(`${REDIS_PREFIX}${redis_keys.billing_credit_balance_}{${org_id}}`).catch(() => null);
  return value === null || value === undefined ? null : String(value);
};

// The org's most recent wallet transactions (grants, top-ups, voids), newest
// first, with the metadata each was tagged with (source / by / reason).
export const listWalletTransactions = async (org_id, { per_page = 10 } = {}) =>
  lagoRequest(async () => {
    const wallet_id = (await fetchActiveWallet(org_id))?.lago_id ?? null;
    if (!wallet_id) return [];
    const response = await axios.get(`${BILLING_API_URL}/wallets/${encodeURIComponent(wallet_id)}/wallet_transactions`, {
      ...billingRequestConfig(),
      params: { page: 1, per_page }
    });
    return (response.data?.wallet_transactions ?? [])
      .map((t) => ({
        lago_id: t.lago_id,
        direction: t.transaction_type, // inbound | outbound
        status: t.status,
        credits: t.credit_amount,
        source: t.source ?? null,
        created_at: t.created_at,
        settled_at: t.settled_at ?? null,
        metadata: Object.fromEntries((t.metadata ?? []).map(({ key, value }) => [key, value]))
      }))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  });

// Add `delta` credits to the gate's shadow balance WITHOUT overwriting it.
//
// gtwy-ai seeds this key NX from Lago and then mutates it with INCRBYFLOAT as
// requests reserve and settle credits. A plain SET here (syncWalletBalanceToRedis)
// would erase the decrements of every in-flight hold — phantom credits. So a
// webhook credit is applied as an increment, and only when the key exists; an
// absent key means nothing is cached and gtwy-ai will seed the post-credit figure
// from Lago on its next request. Returns the new balance, or null when skipped.
export const incrementRedisBalance = async (org_id, delta) => {
  const amount = Number(delta);
  if (!Number.isFinite(amount) || amount === 0) return null;
  if (!client.isReady) return null;
  const key = `${REDIS_PREFIX}${redis_keys.billing_credit_balance_}{${org_id}}`;
  // EXISTS + INCRBYFLOAT are two commands; a seed landing in between would be
  // an NX seed of the post-credit Lago figure, which INCRBYFLOAT then bumps
  // again. Do it atomically in Lua.
  const script = `if redis.call('EXISTS', KEYS[1]) == 1 then return redis.call('INCRBYFLOAT', KEYS[1], ARGV[1]) else return false end`;
  const result = await client.eval(script, { keys: [key], arguments: [String(amount)] }).catch((err) => {
    logger.error(`[lago] incrementRedisBalance failed for org ${org_id}: ${err.message}`);
    return null;
  });
  await invalidateWalletCache(org_id);
  return result === null || result === false ? null : String(result);
};

// Credit a top-up to the wallet once per reference_id. Credits only: since the
// paid plan is sold through Stripe (via Lago), a top-up no longer moves the org
// onto `paid` — that plan carries a monthly fee and is entered only by
// POST /api/billing/subscribe. Use POST /api/lago/plan for a deliberate admin move.
export const topupWallet = async (org_id, credits, { reference_id, metadata = {} } = {}) => {
  if (!(await claimTopupReference(reference_id))) {
    return { duplicate: true, credits_balance: await syncWalletBalanceToRedis(org_id) };
  }

  let transaction;
  try {
    transaction = await walletCredit(String(org_id), credits, {
      ...metadata,
      ...(reference_id ? { reference_id } : {})
    });
  } catch (err) {
    // The credit never reached Lago, so hand the claim back and let the same reference_id retry.
    await releaseTopupClaim(reference_id);
    throw err;
  }

  return { duplicate: false, transaction, credits_balance: await syncWalletBalanceToRedis(org_id) };
};

const CREDIT_USAGE_EVENT_CODE = process.env.BILLING_CREDIT_USAGE_EVENT_CODE;
const CREDIT_USAGE_PROPERTY = process.env.BILLING_CREDIT_USAGE_PROPERTY;
// The per-hit fee gets its OWN Lago metric so an invoice shows AI spend and hit
// fees as separate lines. Fixed rather than env: the metric has the same code in
// every Lago account. Every account must have it, with a charge on EVERY plan,
// before this code runs against it: Lago answers 200 for an event whose metric
// the plan does not price, and then never rates it, so a missing charge silently
// stops the fee (see docs/lago-runbook.md, "Two Lago metrics").
const HIT_FEE_EVENT_CODE = "gtwy_hit_fee";

// Which Lago metric an event is charged on. Only the hit fee is split out; model
// usage and background jobs are both AI credits.
const eventCodeFor = (eventType) => (eventType === "hit_fee" ? HIT_FEE_EVENT_CODE : CREDIT_USAGE_EVENT_CODE);

// Post one usage event to Lago, which rates it against the org's wallet.
export const walletDebit = async (org_id, credits, transaction_id, metadata = {}, { eventType } = {}) =>
  lagoRequest(async () => {
    if (!CREDIT_USAGE_EVENT_CODE) throw new Error("BILLING_CREDIT_USAGE_EVENT_CODE is not configured");
    const properties = { [CREDIT_USAGE_PROPERTY]: String(credits) };
    for (const [key, value] of Object.entries(metadata)) {
      if (value !== undefined && value !== null) properties[key] = String(value);
    }

    // Read the real id; never guess. An org with no active subscription throws
    // a message isWalletNotFoundError() recognises, so debitOne retries it a
    // few times (provisioning may still be in flight) and then stores it as
    // "failed" — visible, alerted, and replayable once the org is provisioned.
    const external_subscription_id = await resolveSubscriptionExternalId(org_id, { timeout: BILLING_DEBIT_TIMEOUT_MS });
    if (!external_subscription_id) {
      // Wording matters: isWalletNotFoundError() matches on "subscription" plus
      // "not found", which is what makes this retryable rather than terminal.
      throw new Error(`active Lago subscription not found for org_id=${org_id} — refusing to post a charge to a guessed external_subscription_id`);
    }

    const event = {
      transaction_id,
      external_subscription_id,
      code: eventCodeFor(eventType),
      properties
    };
    return axios.post(`${BILLING_API_URL}/events`, { event }, billingRequestConfig(BILLING_DEBIT_TIMEOUT_MS)).then((r) => r.data);
  });

// True when Lago rejected a call because the subscription/wallet is not there yet.
export const isWalletNotFoundError = (err) => {
  const status = err?.response?.status ?? err?.lagoStatus;
  if (status === 404) return true;
  const body = err?.response?.data ?? err?.lagoData;
  const message = JSON.stringify(body || err?.message || "").toLowerCase();
  return message.includes("subscription") && (message.includes("not_found") || message.includes("not found"));
};
