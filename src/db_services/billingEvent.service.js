import BillingEventModel from "../mongoModel/BillingEvent.model.js";

// All Mongo access for billing_events lives here. See the model for why this
// collection exists (durable webhook idempotency + per-step checkpoints + the
// one-credit-per-invoice claim).

// A replica that died mid-event leaves a row in "processing". After this long
// another delivery may take it over.
const STALE_PROCESSING_MS = 120_000;

// Keep only what is needed to attribute and replay the event — never the whole object.
const snapshotOf = (object = {}) => ({
  lago_id: object.lago_id ?? null,
  external_id: object.external_id ?? null,
  number: object.number ?? null,
  status: object.status ?? null,
  payment_status: object.payment_status ?? null,
  invoice_type: object.invoice_type ?? null,
  total_amount_cents: object.total_amount_cents ?? null,
  currency: object.currency ?? null,
  external_customer_id: object.external_customer_id ?? object.customer?.external_id ?? null,
  external_subscription_id: object.external_subscription_id ?? null,
  plan_code: object.plan_code ?? null,
  lago_invoice_id: object.lago_invoice_id ?? null,
  provider_customer_id: object.provider_customer_id ?? null,
  provider_error: object.provider_error ?? null,
  error_details: object.error_details ?? null,
  next_action: object.next_action ?? null,
  fee_subscriptions: Array.isArray(object.fees) ? [...new Set(object.fees.map((f) => f.external_subscription_id).filter(Boolean))] : undefined
});

// Insert-first. Returns { fresh: true, doc } when this call owns the event and
// { fresh: false, doc } when a row already exists for unique_key. Anything other
// than a duplicate-key error propagates: Mongo being down is transient and the
// caller answers 500 so Lago retries.
const claim = async ({
  unique_key,
  webhook_type,
  object_type,
  object,
  org_id = null,
  invoice_id = null,
  subscription_external_id = null,
  synthetic = false
}) => {
  const base = {
    unique_key,
    webhook_type,
    object_type: object_type ?? null,
    object_id: object?.lago_id ?? object?.external_id ?? null,
    org_id: org_id ? String(org_id) : null,
    invoice_id,
    subscription_external_id,
    payment_status: object?.payment_status ?? null,
    snapshot: snapshotOf(object),
    synthetic
  };
  try {
    const doc = await BillingEventModel.create({ ...base, status: "processing", processing_started_at: new Date(), attempts: 1 });
    return { fresh: true, doc: doc.toObject() };
  } catch (err) {
    if (err?.code !== 11000) throw err;
    const existing = await BillingEventModel.findOne({ unique_key }).lean();
    return { fresh: false, doc: existing };
  }
};

// Take over a row that is "failed" (not permanent) or stuck in "processing".
// Returns the row when this call won, null when someone else holds it.
const reclaim = async (unique_key) => {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  return BillingEventModel.findOneAndUpdate(
    {
      unique_key,
      $or: [
        { status: "failed", permanent: { $ne: true } },
        { status: "received" },
        { status: "processing", processing_started_at: { $lt: staleBefore } }
      ]
    },
    { $set: { status: "processing", processing_started_at: new Date(), error: "" }, $inc: { attempts: 1 } },
    { new: true }
  ).lean();
};

// Own the wallet credit for an invoice. True when THIS event now holds the
// claim; false when another row already does (the partial unique index fired).
const claimCredit = async (unique_key, invoice_id) => {
  try {
    const result = await BillingEventModel.updateOne({ unique_key, credit_claim: { $ne: true } }, { $set: { credit_claim: true, invoice_id } });
    if (result.modifiedCount === 1) return true;
    // Not modified: either we already hold it, or the row is gone.
    const row = await BillingEventModel.findOne({ unique_key }).lean();
    return Boolean(row?.credit_claim);
  } catch (err) {
    if (err?.code === 11000) return false;
    throw err;
  }
};

const markProcessed = async (unique_key, note = "") => BillingEventModel.updateOne({ unique_key }, { $set: { status: "processed", error: note } });

const markFailed = async (unique_key, error, { permanent = false } = {}) =>
  BillingEventModel.updateOne({ unique_key }, { $set: { status: "failed", permanent, error: String(error?.message ?? error).slice(0, 2000) } });

const markIgnored = async (unique_key, note = "") => BillingEventModel.updateOne({ unique_key }, { $set: { status: "ignored", error: note } });

const setStep = async (unique_key, name, value) => BillingEventModel.updateOne({ unique_key }, { $set: { [`steps.${name}`]: value } });

const setOrg = async (unique_key, org_id) => BillingEventModel.updateOne({ unique_key }, { $set: { org_id: String(org_id) } });

const getByKey = async (unique_key) => BillingEventModel.findOne({ unique_key }).lean();

// True when a wallet credit for this invoice has been claimed (and so either
// landed or is about to). The reconcile job uses it to find paid invoices we missed.
const hasCreditedInvoice = async (invoice_id) => Boolean(await BillingEventModel.exists({ invoice_id, credit_claim: true }));

const listFailedRetryable = async ({ olderThanMs = 600_000, maxAttempts = 10, limit = 200 } = {}) =>
  BillingEventModel.find({
    status: "failed",
    permanent: { $ne: true },
    attempts: { $lt: maxAttempts },
    updated_at: { $lt: new Date(Date.now() - olderThanMs) }
  })
    .sort({ created_at: 1 })
    .limit(limit)
    .lean();

const listByOrg = async (org_id, limit = 100) =>
  BillingEventModel.find({ org_id: String(org_id) })
    .sort({ created_at: -1 })
    .limit(limit)
    .lean();

export default {
  claim,
  reclaim,
  claimCredit,
  markProcessed,
  markFailed,
  markIgnored,
  setStep,
  setOrg,
  getByKey,
  hasCreditedInvoice,
  listFailedRetryable,
  listByOrg,
  STALE_PROCESSING_MS
};
