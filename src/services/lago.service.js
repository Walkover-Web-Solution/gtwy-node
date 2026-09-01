import axios from "axios";

import client from "./cache.service.js";
import OrgBillingModel from "../mongoModel/OrgBilling.model.js";

const BILLING_API_URL = process.env.BILLING_API_URL;
const BILLING_API_KEY = process.env.BILLING_API_KEY;
const BILLING_EVENT_CODE = process.env.BILLING_EVENT_CODE;
// ONE credit rate for both repos. Python divides cost_usd by the same env var
// to compute credits; a silent default here let the two drift apart, so there
// is no default — createWallet refuses to run without it.
const WALLET_RATE_AMOUNT = process.env.LAGO_CREDIT_RATE_USD;
const WALLET_CURRENCY = "USD";
const SIGNUP_GRANT_CREDITS = process.env.LAGO_SIGNUP_GRANT_CREDITS || "1000";
const SIGNUP_GRANT_EXPIRY_DAYS = process.env.LAGO_SIGNUP_GRANT_EXPIRY_DAYS;

// Canonical Lago subscription external_id = the bare org_id — what the
// original createSubscription wrote, so every already-provisioned org keeps
// working with NO migration. (Two later spellings, `sub-${org_id}` and
// `sub_${org_id}`, sent charges to subscriptions that do not exist; orgs
// provisioned by that interim code need one idempotent re-provision run —
// see scripts/provisionLagoOrgs.js.)
export const subscriptionExternalId = (org_id) => String(org_id);

const billingHeaders = () => ({
  Authorization: `Bearer ${BILLING_API_KEY}`,
  "Content-Type": "application/json"
});

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
      .post(`${BILLING_API_URL}/customers`, { customer: { external_id: String(org_id), name: String(org_id) } }, { headers: billingHeaders() })
      .then((r) => r.data)
  );

export const createSubscription = async (org_id) =>
  lagoRequest(() =>
    axios
      .post(
        `${BILLING_API_URL}/subscriptions`,
        {
          subscription: {
            external_customer_id: String(org_id),
            plan_code: BILLING_EVENT_CODE,
            external_id: subscriptionExternalId(org_id),
            name: `subscription-${org_id}`,
            billing_time: "calendar"
          }
        },
        { headers: billingHeaders() }
      )
      .then((r) => r.data)
  );

export const createWallet = async (org_id) => {
  if (!WALLET_RATE_AMOUNT) {
    throw new Error("LAGO_CREDIT_RATE_USD is not set — refusing to create a wallet with an undefined credit rate");
  }
  const wallet = {
    external_customer_id: org_id,
    name: `wallet-${org_id}`,
    currency: WALLET_CURRENCY,
    rate_amount: WALLET_RATE_AMOUNT,
    granted_credits: SIGNUP_GRANT_CREDITS
  };
  if (SIGNUP_GRANT_EXPIRY_DAYS) {
    const expiry = new Date(Date.now() + Number(SIGNUP_GRANT_EXPIRY_DAYS) * 24 * 60 * 60 * 1000);
    wallet.expiration_at = expiry.toISOString();
  }
  const response = await axios.post(`${BILLING_API_URL}/wallets`, { wallet }, { headers: billingHeaders() });
  return response.data;
};

// --- org billing plan (free / paid) ----------------------------------------
// Mongo is the truth; the Redis key is what Python reads on the hot path.
// Every write refreshes both so a plan change is visible within one request.
const ORG_PLAN_KEY = "nd_org_billing_plan_";

const writePlanToRedis = async (org_id, plan) => {
  if (!client.isReady) return;
  await client.set(`${REDIS_PREFIX}${ORG_PLAN_KEY}${org_id}`, plan).catch(() => {});
};

export const ensureOrgPlan = async (org_id) => {
  // Creates the row as "free" for new orgs; never downgrades an existing org.
  const doc = await OrgBillingModel.findOneAndUpdate(
    { org_id: String(org_id) },
    { $setOnInsert: { org_id: String(org_id), plan: "free" } },
    { upsert: true, new: true }
  );
  await writePlanToRedis(org_id, doc.plan);
  return doc.plan;
};

export const markOrgPaid = async (org_id) => {
  const doc = await OrgBillingModel.findOneAndUpdate(
    { org_id: String(org_id) },
    { $set: { plan: "paid", upgraded_at: new Date() } },
    { upsert: true, new: true }
  );
  await writePlanToRedis(org_id, doc.plan);
  return doc.plan;
};

export const ensureOrgSubscribed = async (org_id) => {
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

  let subscription;
  try {
    subscription = await createSubscription(org_id);
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    subscription = { skipped: true, reason: "subscription already exists" };
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

  const plan = await ensureOrgPlan(org_id);

  return { customer, subscription, wallet, plan };
};
export const getWallet = async (org_id) => {
  const response = await axios.get(`${BILLING_API_URL}/wallets`, {
    headers: billingHeaders(),
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
    headers: billingHeaders(),
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
    const response = await axios.post(`${BILLING_API_URL}/wallet_transactions`, { wallet_transaction }, { headers: billingHeaders() });
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
    await markOrgPaid(org_id);
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
    return axios.post(`${BILLING_API_URL}/events`, { event }, { headers: billingHeaders() }).then((r) => r.data);
  });

export const isWalletNotFoundError = (err) => {
  const status = err?.response?.status ?? err?.lagoStatus;
  if (status === 404) return true;
  const body = err?.response?.data ?? err?.lagoData;
  const message = JSON.stringify(body || err?.message || "").toLowerCase();
  return message.includes("subscription") && (message.includes("not_found") || message.includes("not found"));
};
