import StripeEventModel from "../mongoModel/StripeEvent.model.js";

// All Mongo access for stripe_events lives here. See the model for why this
// collection exists (durable webhook idempotency + per-step checkpoints).

// A replica that died mid-event leaves a row in "processing". After this long
// another delivery may take it over.
const STALE_PROCESSING_MS = 120_000;

// Keep only what is needed to attribute and replay the event — never the whole object.
const snapshotOf = (object = {}) => ({
  id: object.id ?? null,
  object: object.object ?? null,
  status: object.status ?? null,
  customer: typeof object.customer === "object" ? object.customer?.id : (object.customer ?? null),
  subscription: object.subscription ?? object.parent?.subscription_details?.subscription ?? null,
  amount_paid: object.amount_paid ?? null,
  currency: object.currency ?? null,
  billing_reason: object.billing_reason ?? null,
  mode: object.mode ?? null,
  metadata: object.metadata ?? {},
  cancel_at_period_end: object.cancel_at_period_end ?? null
});

// Insert-first. Returns { fresh: true, doc } when this call owns the event and
// { fresh: false, doc } when a row already exists (by event_id, or by invoice_id
// for invoice.paid through the partial unique index). Anything other than a
// duplicate-key error propagates: Mongo being down is a transient failure and
// the caller answers 500 so Stripe retries.
const claim = async (event, { org_id = null, invoice_id = null, subscription_id = null } = {}) => {
  const base = {
    event_id: event.id,
    type: event.type,
    livemode: Boolean(event.livemode),
    api_version: event.api_version ?? null,
    created: event.created ? new Date(event.created * 1000) : null,
    org_id: org_id ? String(org_id) : null,
    invoice_id,
    subscription_id,
    snapshot: snapshotOf(event.data?.object)
  };
  try {
    const doc = await StripeEventModel.create({ ...base, status: "processing", processing_started_at: new Date(), attempts: 1 });
    return { fresh: true, doc: doc.toObject() };
  } catch (err) {
    if (err?.code !== 11000) throw err;
    const or = [{ event_id: event.id }];
    if (invoice_id && event.type === "invoice.paid") or.push({ type: "invoice.paid", invoice_id });
    const existing = await StripeEventModel.findOne({ $or: or }).lean();
    return { fresh: false, doc: existing, base };
  }
};

// Take over a row that is "failed" (not permanent) or stuck in "processing".
// Returns the row when this call won, null when someone else holds it.
const reclaim = async (event_id) => {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  return StripeEventModel.findOneAndUpdate(
    {
      event_id,
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

// A second event id for an invoice we already hold: remember the id so its own
// redeliveries are also cheap, without touching the partial index (no invoice_id).
const recordAlias = async (event, note) =>
  StripeEventModel.updateOne(
    { event_id: event.id },
    {
      $setOnInsert: {
        event_id: event.id,
        type: event.type,
        livemode: Boolean(event.livemode),
        created: event.created ? new Date(event.created * 1000) : null,
        status: "ignored",
        error: note,
        snapshot: snapshotOf(event.data?.object)
      }
    },
    { upsert: true }
  );

const markProcessed = async (event_id, steps = {}) =>
  StripeEventModel.updateOne({ event_id }, { $set: { status: "processed", error: "", ...flattenSteps(steps) } });

const markFailed = async (event_id, error, { permanent = false } = {}) =>
  StripeEventModel.updateOne({ event_id }, { $set: { status: "failed", permanent, error: String(error?.message ?? error).slice(0, 2000) } });

const markIgnored = async (event_id, note = "") => StripeEventModel.updateOne({ event_id }, { $set: { status: "ignored", error: note } });

const setStep = async (event_id, name, value) => StripeEventModel.updateOne({ event_id }, { $set: { [`steps.${name}`]: value } });

const setOrg = async (event_id, org_id) => StripeEventModel.updateOne({ event_id }, { $set: { org_id: String(org_id) } });

const getByEventId = async (event_id) => StripeEventModel.findOne({ event_id }).lean();

// True when a paid invoice has already been credited (processed, or at least past the credit step).
const hasProcessedInvoice = async (invoice_id) =>
  Boolean(
    await StripeEventModel.exists({
      type: "invoice.paid",
      invoice_id,
      $or: [{ status: "processed" }, { "steps.credited": true }]
    })
  );

const listFailedRetryable = async ({ olderThanMs = 600_000, maxAttempts = 10, limit = 200 } = {}) =>
  StripeEventModel.find({
    status: "failed",
    permanent: { $ne: true },
    attempts: { $lt: maxAttempts },
    updated_at: { $lt: new Date(Date.now() - olderThanMs) }
  })
    .sort({ created_at: 1 })
    .limit(limit)
    .lean();

const listByOrg = async (org_id, limit = 100) =>
  StripeEventModel.find({ org_id: String(org_id) })
    .sort({ created_at: -1 })
    .limit(limit)
    .lean();

const flattenSteps = (steps) => Object.fromEntries(Object.entries(steps).map(([k, v]) => [`steps.${k}`, v]));

export default {
  claim,
  reclaim,
  recordAlias,
  markProcessed,
  markFailed,
  markIgnored,
  setStep,
  setOrg,
  getByEventId,
  hasProcessedInvoice,
  listFailedRetryable,
  listByOrg,
  STALE_PROCESSING_MS
};
