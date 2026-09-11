import axios from "axios";

import client from "./cache.service.js";
import { REDIS_PREFIX } from "../cache_service/index.js";
import logger from "../logger.js";
import { DEFAULT_PLAN_SLUG, planCodeFor, planSlugForCode } from "../configs/billingPlans.js";
import billingPlanService from "../db_services/billingPlan.service.js";
import { redis_keys } from "../configs/constant.js";

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

const billingHeaders = () => ({
  Authorization: `Bearer ${BILLING_API_KEY}`,
  "Content-Type": "application/json"
});

// Axios config every Lago call uses, so none of them can hang without a timeout.
const billingRequestConfig = () => ({ headers: billingHeaders(), timeout: BILLING_TIMEOUT_MS });

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
export const createCustomer = async (org_id) =>
  lagoRequest(() =>
    axios
      .post(`${BILLING_API_URL}/customers`, { customer: { external_id: String(org_id), name: String(org_id) } }, billingRequestConfig())
      .then((r) => r.data)
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
export const createSubscription = async (org_id, plan_slug = DEFAULT_PLAN_SLUG, { isChange = false, external_id } = {}) =>
  lagoRequest(() => {
    const subscription = {
      external_customer_id: String(org_id),
      plan_code: planCodeFor(plan_slug),
      external_id: external_id || subscriptionExternalId(org_id),
      name: `subscription-${org_id}`
    };
    if (!isChange) subscription.billing_time = "calendar";
    return axios.post(`${BILLING_API_URL}/subscriptions`, { subscription }, billingRequestConfig()).then((r) => r.data);
  });

// The org's active subscription as Lago sees it, or null.
export const getSubscription = async (org_id) => {
  const response = await lagoRequest(() =>
    axios.get(`${BILLING_API_URL}/subscriptions`, {
      ...billingRequestConfig(),
      params: { external_customer_id: String(org_id) }
    })
  );
  const subs = response?.data?.subscriptions || [];
  const active = subs.find((sub) => sub.status === "active") || null;
  const pending = subs.find((sub) => sub.status === "pending") || null;
  if (!active) return pending ? { pending_only: true, pending } : null;
  return {
    external_id: active.external_id,
    plan_code: active.plan_code,
    plan_slug: planSlugForCode(active.plan_code),
    status: active.status,
    pending: pending ? { plan_code: pending.plan_code, status: pending.status } : null
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

export const resolveSubscriptionExternalId = async (org_id) => {
  if (client.isReady) {
    const cached = await client.get(subExternalIdKey(org_id)).catch(() => null);
    if (cached) return cached;
  }

  // Deliberately NOT caught: a Lago failure here must reach walletDebit's retry
  // and then failed_billing_debits, not be flattened into "no subscription".
  const subscription = await getSubscription(org_id);
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
    granted_credits
  };
  const response = await lagoRequest(() => axios.post(`${BILLING_API_URL}/wallets`, { wallet }, billingRequestConfig()));
  return response.data;
};

// Drop the cached plan so the next read comes from Lago. Exported for the
// Stripe reconcile, which repairs Lago-vs-Redis drift it finds.
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
export const changeOrgPlan = async (org_id, plan_slug, { actor = "", reason = "" } = {}) => {
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
    if (current.plan_code === target_code) {
      // Lago already holds the plan; recording it only means clearing the cache.
      await invalidatePlanCache(org_id);
      return { changed: false, deferred: false, plan: plan_slug, previous_plan, plan_code: target_code };
    }

    // Rotate the subscription the org ACTUALLY has, whatever it is spelled.
    await createSubscription(org_id, plan_slug, { isChange: true, external_id: current.external_id });

    // Read back rather than trusting the POST: a deferred change stays pending in Lago.
    const after = await getSubscription(org_id);
    if (!after || after.plan_code !== target_code) {
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
    logger.info(`[lago] org ${org_id} moved ${previous_plan} -> ${plan_slug} by ${actor || "unknown"}${reason ? ` (${reason})` : ""}`);
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
const fetchActiveWallet = async (org_id) => {
  const response = await lagoRequest(() =>
    axios.get(`${BILLING_API_URL}/wallets`, {
      ...billingRequestConfig(),
      params: { external_customer_id: org_id }
    })
  );
  const wallets = response?.data?.wallets || [];
  return wallets.find((w) => w.status === "active") ?? null;
};

// The org's active wallet from Lago, or null.
export const getWallet = async (org_id) => {
  const active = await fetchActiveWallet(org_id);
  if (!active) return null;
  return {
    credits_balance: active.credits_balance,
    balance_cents: active.balance_cents,
    currency: active.currency,
    rate_amount: active.rate_amount,
    ongoing_balance_cents: active.ongoing_balance_cents,
    expiration_at: active.expiration_at,
    credits_ongoing_balance: active.credits_ongoing_balance,
    // Usage consumed but not yet invoiced. credits_balance minus this is the
    // spendable amount, and unlike credits_ongoing_balance it does not depend on
    // Lago's asynchronous refresh job (a brand-new wallet reports ongoing 0.0
    // while credits_balance already holds the grant).
    credits_ongoing_usage_balance: active.credits_ongoing_usage_balance
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

// Credit a paid top-up to the wallet once per reference_id and move the org onto the paid plan.
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

  try {
    await changeOrgPlan(org_id, "paid", { actor: "topup", reason: reference_id || "wallet top-up" });
  } catch (err) {
    logger.error(`[lago] top-up succeeded but plan flip failed for org ${org_id}: ${err.message}`);
  }

  return { duplicate: false, transaction, credits_balance: await syncWalletBalanceToRedis(org_id) };
};

const CREDIT_USAGE_EVENT_CODE = process.env.BILLING_CREDIT_USAGE_EVENT_CODE;
const CREDIT_USAGE_PROPERTY = process.env.BILLING_CREDIT_USAGE_PROPERTY;

// Post one usage event to Lago, which rates it against the org's wallet.
export const walletDebit = async (org_id, credits, transaction_id, metadata = {}) =>
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
    const external_subscription_id = await resolveSubscriptionExternalId(org_id);
    if (!external_subscription_id) {
      // Wording matters: isWalletNotFoundError() matches on "subscription" plus
      // "not found", which is what makes this retryable rather than terminal.
      throw new Error(`active Lago subscription not found for org_id=${org_id} — refusing to post a charge to a guessed external_subscription_id`);
    }

    const event = {
      transaction_id,
      external_subscription_id,
      code: CREDIT_USAGE_EVENT_CODE,
      properties
    };
    return axios.post(`${BILLING_API_URL}/events`, { event }, billingRequestConfig()).then((r) => r.data);
  });

// True when Lago rejected a call because the subscription/wallet is not there yet.
export const isWalletNotFoundError = (err) => {
  const status = err?.response?.status ?? err?.lagoStatus;
  if (status === 404) return true;
  const body = err?.response?.data ?? err?.lagoData;
  const message = JSON.stringify(body || err?.message || "").toLowerCase();
  return message.includes("subscription") && (message.includes("not_found") || message.includes("not found"));
};
