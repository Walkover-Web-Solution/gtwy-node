// Stripe through Lago: config only, no business logic.
//
// Lago owns the Stripe connection (Integrations page); we never hold a Stripe
// key. Two env vars switch the feature on: which Lago payment-provider
// connection an org is attached to, and the HMAC key Lago signs webhooks with.
// Leaving both empty disables /api/billing (checkout, subscribe, cancel, portal,
// webhook, reconcile) without touching wallets, debits or plans.

const providerCode = () => String(process.env.LAGO_STRIPE_PROVIDER_CODE || "").trim();

// Comma-separated so the key can be rotated with zero downtime: set "old,new",
// deploy, regenerate in Lago, drop "old".
export const webhookHmacKeys = () =>
  String(process.env.LAGO_WEBHOOK_HMAC_KEY || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const isLagoBillingEnabled = () => Boolean(providerCode() && webhookHmacKeys().length);

// Days an org keeps Pro after a failed renewal while we retry the charge daily.
// 0 = downgrade on the first failed renewal.
export const graceDays = () => {
  const raw = process.env.BILLING_GRACE_DAYS;
  if (raw === undefined || String(raw).trim() === "") return 7;
  return Number(raw);
};

// Boot check, same idea as assertBillingPlansConfigured: half-configured is
// worse than off, because checkout would work and the webhook would be rejected.
export const assertLagoBillingConfigured = () => {
  const hasProvider = Boolean(providerCode());
  const hasKey = webhookHmacKeys().length > 0;
  if (hasProvider !== hasKey) {
    throw new Error(
      `Stripe-through-Lago is half configured: ${hasProvider ? "LAGO_WEBHOOK_HMAC_KEY is missing" : "LAGO_STRIPE_PROVIDER_CODE is missing"}. ` +
        "Set both to enable billing, or neither to disable it."
    );
  }
  const days = graceDays();
  if (!Number.isInteger(days) || days < 0 || days > 60) {
    throw new Error(`BILLING_GRACE_DAYS must be an integer between 0 and 60 (got '${process.env.BILLING_GRACE_DAYS}')`);
  }
};
