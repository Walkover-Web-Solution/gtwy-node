import Stripe from "stripe";

// Stripe is the money side of billing: it holds the card, runs the $20/month
// Pro subscription, retries failed charges and emails the customer. Lago stays
// the credit ledger and the plan-of-record gtwy-ai reads. The two meet in the
// webhook (src/services/stripeBilling.service.js). Everything here is config
// and payload-shape helpers; no business logic.

const key = () => process.env.STRIPE_SECRET_KEY || "";

// Leaving STRIPE_SECRET_KEY empty disables /api/billing entirely (checkout,
// portal, webhook, nightly reconcile) without touching anything else.
export const isStripeConfigured = () => Boolean(key());

export const isLiveMode = () => key().startsWith("sk_live_");

// Comma-separated so a signing secret can be rotated with zero downtime:
// set "old,new", deploy, flip the Dashboard, drop "old".
export const webhookSecrets = () =>
  String(process.env.STRIPE_WEBHOOK_SECRET || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

let client = null;

// Lazy so importing this module never needs env, and so the pure helpers below
// can be exercised without a key.
export const getStripe = () => {
  if (!isStripeConfigured()) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY is empty)");
  if (!client) {
    client = new Stripe(key(), {
      // MUST equal the API version set on the webhook endpoint in the Dashboard,
      // or the payload shapes the accessors below expect will not match.
      apiVersion: process.env.STRIPE_API_VERSION || undefined,
      timeout: 10000,
      maxNetworkRetries: 2,
      appInfo: { name: "gtwy-ai-middleware" }
    });
  }
  return client;
};

// Boot check, same idea as assertBillingPlansConfigured: if Stripe is on, every
// piece it needs must be present, or the container refuses to start.
export const assertStripeConfigured = () => {
  if (!isStripeConfigured()) return;
  const required = ["STRIPE_WEBHOOK_SECRET", "STRIPE_CHECKOUT_SUCCESS_URL", "STRIPE_CHECKOUT_CANCEL_URL", "STRIPE_PORTAL_RETURN_URL"];
  const missing = required.filter((name) => !String(process.env[name] || "").trim());
  if (missing.length) {
    throw new Error(`STRIPE_SECRET_KEY is set but these are missing: ${missing.join(", ")}`);
  }
  if (isLiveMode()) {
    const localhost = required.slice(1).filter((name) => /localhost|127\.0\.0\.1/.test(String(process.env[name])));
    if (localhost.length) throw new Error(`live Stripe key with localhost redirect URLs: ${localhost.join(", ")}`);
  }
};

// --- payload-shape helpers -------------------------------------------------
// Stripe's 2025-03-31 ("Basil") API moved several fields. Which shape we get
// depends on the API version pinned on the SDK AND on the Dashboard endpoint,
// so every read goes through one of these and accepts both. Getting this wrong
// is the most likely way for the whole integration to silently do nothing.

// Expanded objects arrive as {id, ...}; unexpanded as the bare id string.
export const idOf = (value) => (value && typeof value === "object" ? value.id : value) ?? null;

export const invoiceSubscriptionId = (invoice) => idOf(invoice?.parent?.subscription_details?.subscription ?? invoice?.subscription);

export const invoiceSubscriptionMetadata = (invoice) =>
  invoice?.parent?.subscription_details?.metadata ?? invoice?.subscription_details?.metadata ?? {};

export const invoiceLines = (invoice) => invoice?.lines?.data ?? [];

export const linePriceId = (line) => idOf(line?.pricing?.price_details?.price ?? line?.price?.id ?? line?.price);

export const subscriptionPriceId = (subscription) => idOf(subscription?.items?.data?.[0]?.price?.id ?? subscription?.items?.data?.[0]?.price);

export const subscriptionPeriod = (subscription) => ({
  start: subscription?.current_period_start ?? subscription?.items?.data?.[0]?.current_period_start ?? null,
  end: subscription?.current_period_end ?? subscription?.items?.data?.[0]?.current_period_end ?? null
});

export const toDate = (unixSeconds) => (Number.isFinite(Number(unixSeconds)) && unixSeconds ? new Date(Number(unixSeconds) * 1000) : null);
