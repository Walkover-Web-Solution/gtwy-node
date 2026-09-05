import axios from "axios";

import client from "./cache.service.js";
import logger from "../logger.js";
import OrgBillingModel from "../mongoModel/OrgBilling.model.js";
import { DEFAULT_PLAN_SLUG, planCodeFor, planSlugForCode } from "../configs/billingPlans.js";

const BILLING_API_URL = process.env.BILLING_API_URL;
const BILLING_API_KEY = process.env.BILLING_API_KEY;
// ONE credit rate for both repos. Python divides cost_usd by the same env var
// to compute credits; a silent default here let the two drift apart, so there
// is no default — createWallet refuses to run without it.
const WALLET_RATE_AMOUNT = process.env.LAGO_CREDIT_RATE_USD;
const WALLET_CURRENCY = "USD";
const SIGNUP_GRANT_CREDITS = process.env.LAGO_SIGNUP_GRANT_CREDITS || "1000";

// Canonical Lago subscription external_id = the bare org_id — what the
// original createSubscription wrote, so every already-provisioned org keeps
// working with NO migration. (Two later spellings, `sub-${org_id}` and
// `sub_${org_id}`, sent charges to subscriptions that do not exist; orgs
// provisioned by that interim code need one idempotent re-provision run —
// see scripts/provisionLagoOrgs.js.)
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

// Spread into an axios config so every Lago call inherits the timeout. The GET
// call sites build their own config object and must spread this too.
const billingRequestConfig = () => ({ headers: billingHeaders(), timeout: BILLING_TIMEOUT_MS });

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
export const createSubscription = async (org_id, plan_slug = DEFAULT_PLAN_SLUG, { isChange = false } = {}) =>
  lagoRequest(() => {
    const subscription = {
      external_customer_id: String(org_id),
      plan_code: planCodeFor(plan_slug),
      external_id: subscriptionExternalId(org_id),
      name: `subscription-${org_id}`
    };
    if (!isChange) subscription.billing_time = "calendar";
    return axios.post(`${BILLING_API_URL}/subscriptions`, { subscription }, billingRequestConfig()).then((r) => r.data);
  });

// The org's ACTIVE subscription as Lago sees it, or null. Everything that must
// not blindly overwrite a plan reads this first.
export const getSubscription = async (org_id) => {
  const response = await axios.get(`${BILLING_API_URL}/subscriptions`, {
    ...billingRequestConfig(),
    params: { external_customer_id: String(org_id) }
  });
  const subs = response?.data?.subscriptions || [];
  const active = subs.find((sub) => sub.status === "active") || null;
  // A `pending` subscription means Lago scheduled a DEFERRED downgrade, which
  // only happens when the target plan costs less than the current one. With
  // both our plans at amount_cents 0 it should never occur, and changeOrgPlan
  // refuses to update our records if it does.
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

export const createWallet = async (org_id) => {
  if (!WALLET_RATE_AMOUNT) {
    throw new Error("LAGO_CREDIT_RATE_USD is not set — refusing to create a wallet with an undefined credit rate");
  }
  // NO expiration_at, deliberately. LAGO_SIGNUP_GRANT_EXPIRY_DAYS used to be
  // set here, meaning to expire the unused SIGNUP GRANT — but in Lago
  // expiration_at expires the ENTIRE WALLET and voids everything left in it,
  // and topupWallet never clears it. So an org provisioned on day 0 that pays
  // on day 80 loses those PAID credits on day 90.
  //
  // Lago has no per-transaction expiry (checked: POST /wallet_transactions
  // accepts no expiration_at), so expiring only the grant would mean a second
  // wallet per org — and getWallet/findActiveWalletId/syncWalletBalanceToRedis
  // all assume exactly one and would each silently pick an arbitrary one.
  // At LAGO_CREDIT_RATE_USD 0.0025 a 100-credit grant is $0.25, so that
  // machinery would exist to reclaim a quarter per dormant signup. Dropped.
  const wallet = {
    external_customer_id: org_id,
    name: `wallet-${org_id}`,
    currency: WALLET_CURRENCY,
    rate_amount: WALLET_RATE_AMOUNT,
    granted_credits: SIGNUP_GRANT_CREDITS
  };
  const response = await axios.post(`${BILLING_API_URL}/wallets`, { wallet }, billingRequestConfig());
  return response.data;
};

// --- org billing plan (free / paid) ----------------------------------------
// Mongo is the truth; the Redis key is what Python reads on the hot path.
// Every write refreshes both so a plan change is visible within one request.
const ORG_PLAN_KEY = "nd_org_billing_plan_";

// DELETE, don't SET. This used to be a bare SET with NO TTL while gtwy-ai
// writes the same key with ex=3600 on a cache miss — so Node's value was
// immortal, gtwy-ai never revalidated it, and DELETE /api/utils/redis
// deliberately refuses nd_ keys. A stale plan was unfixable without redis-cli.
//
// Deleting leaves exactly one writer (gtwy-ai, with its own TTL) and is correct
// within one request: the next read misses, reads Mongo, caches the fresh
// value. A failed delete leaves a stale value for at most an hour — bounded and
// self-healing, rather than forever.
const invalidatePlanCache = async (org_id) => {
  if (!client.isReady) return;
  await client.del(`${REDIS_PREFIX}${ORG_PLAN_KEY}${org_id}`).catch(() => {});
};

export const ensureOrgPlan = async (org_id) => {
  // Creates the row as "free" for new orgs; never downgrades an existing org.
  const doc = await OrgBillingModel.findOneAndUpdate(
    { org_id: String(org_id) },
    { $setOnInsert: { org_id: String(org_id), plan: "free" } },
    { upsert: true, new: true }
  );
  await invalidatePlanCache(org_id);
  return doc.plan;
};

// Writes ANY plan slug. Replaces markOrgPaid, which hardcoded "paid" and so
// could only ratchet an org upward — leaving no way to undo a mistaken upgrade
// except editing Mongo by hand.
export const markOrgPlan = async (org_id, plan_slug) => {
  const doc = await OrgBillingModel.findOneAndUpdate(
    { org_id: String(org_id) },
    { $set: { plan: String(plan_slug), upgraded_at: new Date() } },
    { upsert: true, new: true }
  );
  await invalidatePlanCache(org_id);
  return doc.plan;
};

export const ensureOrgSubscribed = async (org_id, { plan_slug = DEFAULT_PLAN_SLUG } = {}) => {
  const isAlreadyExists = (err) => {
    const status = err?.response?.status;
    return status === 422 || status === 409;
  };

  // Customers and subscriptions are UPSERTS in Lago (verified live: re-POST
  // returns 200, never 409/422) — calling them again is naturally idempotent.
  let customer;
  try {
    customer = await createCustomer(org_id);
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    customer = { skipped: true, reason: "customer already exists" };
  }

  // READ BEFORE WRITE. This function runs on every MSG91 signup webhook and on
  // every run of scripts/provisionLagoOrgs.js. With ONE plan code, POSTing it
  // blindly was a no-op. With two, the same POST is a PLAN CHANGE that Lago
  // applies immediately (both our plans are amount_cents 0, so every switch is
  // classified as an upgrade) — so re-running the provisioner would knock every
  // Pro org back to free and mint an :upgrading invoice for each.
  //
  // So: an org that already has a subscription keeps it, whatever plan it is on.
  // Moving an org between plans is changeOrgPlan's job and nothing else's.
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
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
      subscription = { skipped: true, reason: "subscription already exists" };
    }
  }

  // Wallets are NOT idempotent: Lago happily creates a second active wallet,
  // each carrying the full signup grant (verified live — a re-provision minted
  // another 1000 free credits, and usage then rated against one wallet while
  // top-ups landed in the other). Check for an existing active wallet first.
  let wallet = null;
  const existingWallet = await getWallet(org_id);
  if (existingWallet) {
    wallet = { skipped: true, reason: "active wallet already exists" };
  } else {
    try {
      wallet = await createWallet(org_id);
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
      wallet = { skipped: true, reason: "wallet already exists" };
    }
  }

  // Reconcile Mongo to what Lago ACTUALLY reports, not to what was requested —
  // an org that was already on Pro must not be recorded as free.
  const lagoSlug = subscription?.plan_slug || existingSubscription?.plan_slug;
  const plan = lagoSlug && lagoSlug !== DEFAULT_PLAN_SLUG ? await markOrgPlan(org_id, lagoSlug) : await ensureOrgPlan(org_id);

  return { customer, subscription, wallet, plan };
};

// The ONLY function allowed to move an org between plans.
//
// Order is deliberate: Lago FIRST, then Mongo, then the cache. If Lago succeeds
// and Mongo fails the org is over-restricted — recoverable, and it matches the
// fail-closed stance gtwy-ai already takes. Reverse the order and a Lago failure
// leaves us un-gating an org whose Lago plan has no matching charge, so its
// usage is never rated: free inference. Never that way round.
export const changeOrgPlan = async (org_id, plan_slug, { actor = "", reason = "" } = {}) => {
  const target_code = planCodeFor(plan_slug); // throws on an unknown slug or unset env

  if (!(await claimPlanChange(org_id))) {
    throw new Error(`a plan change for org ${org_id} is already in progress`);
  }
  try {
    const current = await getSubscription(org_id);
    if (!current || current.pending_only) {
      // Deliberately not auto-provisioning: the caller thinks it is changing a
      // plan, not minting a subscription and a wallet.
      throw new Error(`org ${org_id} has no active Lago subscription — provision it first`);
    }

    const previous_plan = current.plan_slug;
    if (current.plan_code === target_code) {
      // Lago would no-op anyway; still reconcile our own two stores.
      await markOrgPlan(org_id, plan_slug);
      return { changed: false, deferred: false, plan: plan_slug, previous_plan, plan_code: target_code };
    }

    await createSubscription(org_id, plan_slug, { isChange: true });

    // Read back rather than trusting the POST. If Lago returned `pending` the
    // change is DEFERRED to the end of the billing period (only possible once a
    // plan carries a real fee) — recording it now would put our gate a month
    // ahead of Lago, so we refuse and report it.
    const after = await getSubscription(org_id);
    if (!after || after.plan_code !== target_code) {
      const pendingCode = after?.pending?.plan_code || after?.pending_only;
      throw new Error(
        `Lago did not activate plan '${plan_slug}' for org ${org_id} — ` +
          `still on '${after?.plan_code}'${pendingCode ? `, change is pending` : ""}. Our records are unchanged.`
      );
    }

    await markOrgPlan(org_id, plan_slug);
    logger.info(`[lago] org ${org_id} moved ${previous_plan} -> ${plan_slug} by ${actor || "unknown"}${reason ? ` (${reason})` : ""}`);
    return { changed: true, deferred: false, plan: plan_slug, previous_plan, plan_code: target_code };
  } finally {
    await releasePlanChange(org_id);
  }
};

// The org's plan slug as recorded in Mongo, defaulting for an org with no row
// yet. Kept here so controllers never reach into OrgBillingModel directly.
export const getOrgPlanSlug = async (org_id) => {
  const doc = await OrgBillingModel.findOne({ org_id: String(org_id) }).lean();
  return doc?.plan || DEFAULT_PLAN_SLUG;
};

// Read-only drift check across the three places a plan is recorded. These are
// updated in sequence with no transaction, so a crash mid-change leaves them
// disagreeing — and without this that is completely invisible.
export const reconcileOrgPlan = async (org_id) => {
  const [subscription, doc] = await Promise.all([
    getSubscription(org_id).catch(() => null),
    OrgBillingModel.findOne({ org_id: String(org_id) }).lean()
  ]);
  let redis_plan = null;
  if (client.isReady) {
    redis_plan = await client.get(`${REDIS_PREFIX}${ORG_PLAN_KEY}${org_id}`).catch(() => null);
  }
  const lago_plan = subscription?.plan_slug ?? null;
  const mongo_plan = doc?.plan ?? null;
  // Redis absent is NOT drift — it is the normal state after an invalidation;
  // gtwy-ai repopulates it from Mongo on the next request.
  const drift = lago_plan !== mongo_plan || (redis_plan !== null && redis_plan !== mongo_plan);
  return {
    org_id: String(org_id),
    lago_plan_code: subscription?.plan_code ?? null,
    lago_plan,
    mongo_plan,
    redis_plan,
    pending: subscription?.pending ?? null,
    drift
  };
};
export const getWallet = async (org_id) => {
  const response = await axios.get(`${BILLING_API_URL}/wallets`, {
    ...billingRequestConfig(),
    params: { external_customer_id: org_id }
  });
  const wallets = response?.data?.wallets || [];
  const active = wallets.find((w) => w.status === "active");
  if (!active) return null;
  return {
    credits_balance: active.credits_balance,
    balance_cents: active.balance_cents,
    currency: active.currency,
    rate_amount: active.rate_amount,
    ongoing_balance_cents: active.ongoing_balance_cents,
    expiration_at: active.expiration_at,
    credits_ongoing_balance: active.credits_ongoing_balance
  };
};

const REDIS_PREFIX = `AIMIDDLEWARE_${process.env.ENVIRONMENT}_`;
const CREDIT_BALANCE_KEY = "nd_billing_credit_balance_";
const TOPUP_APPLIED_KEY = "nd_billing_topup_applied_";
const TOPUP_APPLIED_TTL = 86400;

const topupClaimKey = (reference_id) => `${REDIS_PREFIX}${TOPUP_APPLIED_KEY}${reference_id}`;

// Per-org lock so two concurrent plan changes cannot race Lago into a
// half-rotated state. Same NX pattern as the topup claim below; short TTL so a
// crashed request cannot wedge an org.
const PLAN_CHANGE_LOCK_KEY = "nd_billing_plan_lock_";
const PLAN_CHANGE_LOCK_TTL = 30;

const claimPlanChange = async (org_id) => {
  if (!client.isReady) return true; // fail open: no lock without Redis
  const claimed = await client.set(`${REDIS_PREFIX}${PLAN_CHANGE_LOCK_KEY}${org_id}`, "1", {
    NX: true,
    EX: PLAN_CHANGE_LOCK_TTL
  });
  return claimed !== null;
};

const releasePlanChange = async (org_id) => {
  if (!client.isReady) return;
  await client.del(`${REDIS_PREFIX}${PLAN_CHANGE_LOCK_KEY}${org_id}`).catch(() => {});
};

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

const findActiveWalletId = async (org_id) => {
  const response = await axios.get(`${BILLING_API_URL}/wallets`, {
    ...billingRequestConfig(),
    params: { external_customer_id: org_id }
  });
  const wallets = response?.data?.wallets || [];
  return wallets.find((w) => w.status === "active")?.lago_id ?? null;
};

export const walletCredit = async (org_id, credits, metadata = {}) =>
  lagoRequest(async () => {
    const wallet_id = await findActiveWalletId(org_id);
    if (!wallet_id) throw new Error(`no active wallet found for org_id=${org_id}`);

    // granted_credits, not paid_credits: payment is collected OUTSIDE Lago
    // (our own gateway) and this endpoint records the result. paid_credits
    // creates a pending transaction that waits on a Lago invoice nobody pays —
    // verified live: the balance never moved.
    const wallet_transaction = {
      wallet_id,
      granted_credits: String(credits),
      metadata: Object.entries(metadata).map(([key, value]) => ({ key, value: String(value) }))
    };
    const response = await axios.post(`${BILLING_API_URL}/wallet_transactions`, { wallet_transaction }, billingRequestConfig());
    return response.data;
  });

export const syncWalletBalanceToRedis = async (org_id) => {
  const wallet = await getWallet(String(org_id));
  if (!wallet) return null;

  const balance = String(wallet.credits_ongoing_balance ?? wallet.credits_balance ?? "0");
  if (!client.isReady) return balance;

  // NOTE: bare SET — this erases the decrement of any hold in flight at this
  // moment. Admin/topup-triggered only; acceptable because holds are small,
  // flat, and self-correct at release. Never call this from a hot path.
  await client.set(`${REDIS_PREFIX}${CREDIT_BALANCE_KEY}{${org_id}}`, balance);
  return balance;
};

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
    // The credit never reached Lago — hand the claim back so the SAME
    // reference_id can retry. Keeping it made every retry a fake "duplicate":
    // customer paid, wallet never credited, API said success.
    await releaseTopupClaim(reference_id);
    throw err;
  }

  // A real top-up upgrades the org to the paid plan (admin/comp top-ups too).
  try {
    await markOrgPlan(org_id, "paid");
  } catch (err) {
    console.error(`[lago] top-up succeeded but plan flip failed for org ${org_id}: ${err.message}`);
  }

  return { duplicate: false, transaction, credits_balance: await syncWalletBalanceToRedis(org_id) };
};

const CREDIT_USAGE_EVENT_CODE = process.env.BILLING_CREDIT_USAGE_EVENT_CODE;
const CREDIT_USAGE_PROPERTY = process.env.BILLING_CREDIT_USAGE_PROPERTY;

export const walletDebit = async (org_id, credits, transaction_id, metadata = {}) =>
  lagoRequest(() => {
    if (!CREDIT_USAGE_EVENT_CODE) throw new Error("BILLING_CREDIT_USAGE_EVENT_CODE is not configured");
    const properties = { [CREDIT_USAGE_PROPERTY]: String(credits) };
    for (const [key, value] of Object.entries(metadata)) {
      if (value !== undefined && value !== null) properties[key] = String(value);
    }

    const event = {
      transaction_id,
      external_subscription_id: subscriptionExternalId(org_id),
      code: CREDIT_USAGE_EVENT_CODE,
      properties
    };
    return axios.post(`${BILLING_API_URL}/events`, { event }, billingRequestConfig()).then((r) => r.data);
  });

export const isWalletNotFoundError = (err) => {
  const status = err?.response?.status ?? err?.lagoStatus;
  if (status === 404) return true;
  const body = err?.response?.data ?? err?.lagoData;
  const message = JSON.stringify(body || err?.message || "").toLowerCase();
  return message.includes("subscription") && (message.includes("not_found") || message.includes("not found"));
};
