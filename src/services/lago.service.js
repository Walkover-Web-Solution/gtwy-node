import axios from "axios";

import client from "./cache.service.js";

const BILLING_API_URL = process.env.BILLING_API_URL;
const BILLING_API_KEY = process.env.BILLING_API_KEY;
const BILLING_EVENT_CODE = process.env.BILLING_EVENT_CODE;
const WALLET_RATE_AMOUNT = process.env.LAGO_WALLET_RATE_AMOUNT || "0.0025";
const WALLET_CURRENCY = "USD";
const SIGNUP_GRANT_CREDITS = process.env.LAGO_SIGNUP_GRANT_CREDITS || "1000";
const SIGNUP_GRANT_EXPIRY_DAYS = process.env.LAGO_SIGNUP_GRANT_EXPIRY_DAYS;

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
            external_id: `sub-${org_id}`,
            name: `subscription-${org_id}`,
            billing_time: "calendar"
          }
        },
        { headers: billingHeaders() }
      )
      .then((r) => r.data)
  );

export const createWallet = async (org_id) => {
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

export const ensureOrgSubscribed = async (org_id) => {
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

  let subscription;
  try {
    subscription = await createSubscription(org_id);
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    subscription = { skipped: true, reason: "subscription already exists" };
  }
  let wallet = null;
  try {
    wallet = await createWallet(org_id);
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    wallet = { skipped: true, reason: "wallet already exists" };
  }

  return { customer, subscription, wallet };
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

const claimTopupReference = async (reference_id) => {
  if (!reference_id || !client.isReady) return true;
  const claimed = await client.set(`${REDIS_PREFIX}${TOPUP_APPLIED_KEY}${reference_id}`, "1", {
    NX: true,
    EX: TOPUP_APPLIED_TTL
  });
  return claimed !== null;
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

    const wallet_transaction = {
      wallet_id,
      paid_credits: String(credits),
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

  await client.set(`${REDIS_PREFIX}${CREDIT_BALANCE_KEY}{${org_id}}`, balance);
  return balance;
};

export const topupWallet = async (org_id, credits, { reference_id, metadata = {} } = {}) => {
  if (!(await claimTopupReference(reference_id))) {
    return { duplicate: true, credits_balance: await syncWalletBalanceToRedis(org_id) };
  }

  const transaction = await walletCredit(String(org_id), credits, {
    ...metadata,
    ...(reference_id ? { reference_id } : {})
  });

  return { duplicate: false, transaction, credits_balance: await syncWalletBalanceToRedis(org_id) };
};

const CREDIT_USAGE_EVENT_CODE = process.env.BILLING_CREDIT_USAGE_EVENT_CODE;
const CREDIT_USAGE_PROPERTY = process.env.BILLING_CREDIT_USAGE_PROPERTY;

export const walletDebit = async (org_id, credits, transaction_id, metadata = {}) =>
  lagoRequest(() => {
    if (!CREDIT_USAGE_EVENT_CODE) throw new Error("BILLING_CREDIT_USAGE_EVENT_CODE is not configured");
    const properties = { [CREDIT_USAGE_PROPERTY]: String(credits) };
    for (const [key, value] of Object.entries(metadata)) properties[key] = String(value);

    const event = {
      transaction_id,
      external_subscription_id: `sub-${org_id}`,
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
