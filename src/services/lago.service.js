import axios from "axios";

const BILLING_API_URL = process.env.BILLING_API_URL;
const BILLING_API_KEY = process.env.BILLING_API_KEY;
const BILLING_EVENT_CODE = process.env.BILLING_EVENT_CODE;

// Wallet economics (docs/billing-idempotency-outbox-credit-system.md §4).
// $1 = 400 credits -> rate_amount = 0.0025. Fixed at wallet creation; must not
// change afterward. Overridable via env for staging, but treat as constant in prod.
const WALLET_RATE_AMOUNT = process.env.LAGO_WALLET_RATE_AMOUNT || "0.0025";
const WALLET_CURRENCY = process.env.LAGO_WALLET_CURRENCY || "USD";
// 1000-credit signup grant. DEFAULT DECISION (pending finance sign-off): grant
// expires after 90 days to avoid an unbounded liability (doc §4). Set
// LAGO_SIGNUP_GRANT_EXPIRY_DAYS="" to disable expiry.
const SIGNUP_GRANT_CREDITS = process.env.LAGO_SIGNUP_GRANT_CREDITS || "1000";
const SIGNUP_GRANT_EXPIRY_DAYS = process.env.LAGO_SIGNUP_GRANT_EXPIRY_DAYS === undefined ? "90" : process.env.LAGO_SIGNUP_GRANT_EXPIRY_DAYS;

const billingHeaders = () => ({
  Authorization: `Bearer ${BILLING_API_KEY}`,
  "Content-Type": "application/json"
});

// Wraps any axios call to Lago and enriches the thrown error with the actual
// Lago response body so callers see e.g. "plan not found" instead of just 404.
const lagoRequest = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    if (err?.response) {
      const { status, data } = err.response;
      const lagoError = new Error(`Lago API error ${status}: ${JSON.stringify(data)}`);
      lagoError.response = err.response; // keep original response for isAlreadyExists checks
      lagoError.lagoStatus = status;
      lagoError.lagoData = data;
      throw lagoError;
    }
    throw err;
  }
};

// Deterministic transaction_id for the signup grant (doc §4). No timestamp / no
// random component, so a backfill re-run is deduped by Lago. Mirrors the Python
// billing.primitives.signup_grant_transaction_id contract (cross-plane frozen
// convention).
export const signupGrantTransactionId = (org_id) => `signup-grant-${org_id}`;

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
            // plan_code must match an existing plan in your Lago instance.
            // Currently resolved to: "gtwy_standard" (BILLING_EVENT_CODE).
            plan_code: BILLING_EVENT_CODE,
            // Deterministic external_id — Lago deduplicates on this key.
            external_id: `sub-${org_id}`,
            name: `subscription-${org_id}`,
            billing_time: "calendar"
          }
        },
        { headers: billingHeaders() }
      )
      .then((r) => r.data)
  );

// Create the org's wallet WITH the 1000-credit signup grant baked into the same
// call (doc §4). granted_credits on wallet-create is atomic — no separate grant
// transaction to dedup, and re-running idempotent wallet creation can't
// double-grant. Lago rejects a second active wallet for the same customer, so a
// duplicate call after the wallet already exists fails cleanly; callers treat
// that as "already provisioned", not an error.
export const createWallet = async (org_id) => {
  const wallet = {
    external_customer_id: org_id,
    name: `wallet-${org_id}`,
    currency: WALLET_CURRENCY,
    rate_amount: WALLET_RATE_AMOUNT,
    granted_credits: SIGNUP_GRANT_CREDITS
  };
  if (SIGNUP_GRANT_EXPIRY_DAYS) {
    // Lago expects an ISO8601 date for expiration_at. Kept as a relative day
    // count so the policy is one env var, not a hardcoded date.
    const expiry = new Date(Date.now() + Number(SIGNUP_GRANT_EXPIRY_DAYS) * 24 * 60 * 60 * 1000);
    wallet.expiration_at = expiry.toISOString();
  }
  const response = await axios.post(`${BILLING_API_URL}/wallets`, { wallet }, { headers: billingHeaders() });
  return response.data;
};

export const ensureOrgSubscribed = async (org_id) => {
  // Each step is idempotent: 422 (Unprocessable) and 409 (Conflict) both mean
  // the resource already exists — treat as "already provisioned", not an error.
  // This makes the whole function safe to replay on webhook retries (doc §9.4).
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

  // Provision the wallet + signup grant at org-creation time. This is the fix
  // for the new-org wallet race (doc §9.4): the wallet exists before the first
  // billable call.
  let wallet = null;
  try {
    wallet = await createWallet(org_id);
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    wallet = { skipped: true, reason: "wallet already exists" };
  }

  return { customer, subscription, wallet };
};

// Platform fee taken at top-up time (doc §6). DEFAULT DECISION (pending finance
// sign-off): fee is DEDUCTED from the purchase ($10 loads $9.50), matching the
// doc's topup_split example and the Python billing.primitives implementation.
const PLATFORM_FEE_RATE = Number(process.env.LAGO_PLATFORM_FEE_RATE || "0.05");

const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;

// Fee-first, net-by-subtraction so the two legs always reconcile exactly to the
// gross (never two independent roundings). Mirrors Python billing.primitives.topup_split.
export const topupSplit = (grossAmountUsd) => {
  const gross = Number(grossAmountUsd);
  if (!(gross > 0)) throw new Error("topupSplit requires a positive gross amount");
  const feeUsd = round4(gross * PLATFORM_FEE_RATE);
  const netUsd = round4(gross - feeUsd);
  const netCredits = round4(netUsd / Number(WALLET_RATE_AMOUNT));
  if (!(netCredits > 0)) throw new Error("top-up too small: nets zero credits after fee");
  return { grossUsd: round4(gross), feeUsd, netUsd, netCredits };
};

export const walletTopupTransactionId = (gatewayEventId) => `wallet-topup-${gatewayEventId}`;

// Read an org's current wallet (balance in credits + grant state) for display.
// Returns null if the org has no active wallet yet.
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
    expiration_at: active.expiration_at
  };
};

// Credit a wallet for a top-up (doc §6) or any inbound transaction. transaction_id
// is the idempotency/dedup key; Lago no-ops a duplicate.
export const walletCredit = async (org_id, credits, transaction_id, metadata = {}) => {
  const wallet_transaction = {
    external_customer_id: org_id,
    transaction_type: "inbound",
    amount: String(credits),
    transaction_id
  };
  const meta = Object.entries(metadata).map(([key, value]) => ({ key, value: String(value) }));
  if (meta.length) wallet_transaction.metadata = meta;

  const response = await axios.post(`${BILLING_API_URL}/wallet_transactions`, { wallet_transaction }, { headers: billingHeaders() });
  return response.data;
};

// Debit a wallet for completed LLM usage (doc §4, §2). `credits` and
// `transaction_id` MUST come from the Python billing.primitives event verbatim —
// credits are frozen at write time (§9.1) and transaction_id is the message_id-
// keyed dedup key (§2): a retried/redelivered event with the same transaction_id
// is a safe no-op on Lago's side, which is the actual exactly-once guarantee.
export const walletDebit = async (org_id, credits, transaction_id, metadata = {}) => {
  const wallet_transaction = {
    external_customer_id: org_id,
    transaction_type: "outbound",
    amount: String(credits),
    transaction_id
  };
  const meta = Object.entries(metadata).map(([key, value]) => ({ key, value: String(value) }));
  if (meta.length) wallet_transaction.metadata = meta;

  const response = await axios.post(`${BILLING_API_URL}/wallet_transactions`, { wallet_transaction }, { headers: billingHeaders() });
  return response.data;
};

// True when the failure looks like "org has no active wallet yet" — the
// residual new-org race (doc §9.4). The wallet is provisioned by
// ensureOrgSubscribed at org-creation time, so this should be transient; callers
// treat it as RETRYABLE, never a permanent drop.
export const isWalletNotFoundError = (err) => {
  const status = err?.response?.status ?? err?.lagoStatus;
  if (status === 404) return true;
  const body = err?.response?.data ?? err?.lagoData;
  const message = JSON.stringify(body || err?.message || "").toLowerCase();
  return message.includes("wallet") && (message.includes("not_found") || message.includes("not found"));
};
