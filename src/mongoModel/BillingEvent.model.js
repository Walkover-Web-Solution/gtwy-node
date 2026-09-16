import mongoose from "mongoose";

// Every Lago webhook we have seen, and what we did with it. This is the durable
// idempotency layer: Lago retries a failed delivery only 3 times within
// seconds, and may deliver the same event more than once, so dedup cannot live
// in a Redis key with a TTL (the top-up claim in lago.service.js is 24h and
// fails open — unusable for money). Insert-first on unique_key (Lago's
// X-Lago-Unique-Key header); the caller decides from the existing row's status
// what to do on a duplicate.
//
// steps.* are checkpoints inside one paid-invoice event: credited -> synced. A
// retry after a mid-flight crash resumes at the first unfinished step instead
// of repeating the credit.
//
// credit_claim marks THE row that owns the wallet credit for an invoice. The
// partial unique index on invoice_id means two rows (a webhook and a
// reconcile-synthesised event, say) can never both credit the same invoice.
export const BILLING_EVENT_STATUSES = ["received", "processing", "processed", "failed", "ignored"];

const BillingEventSchema = new mongoose.Schema(
  {
    unique_key: { type: String, required: true, unique: true },
    webhook_type: { type: String, required: true, index: true },
    object_type: { type: String, default: null },
    object_id: { type: String, default: null },

    org_id: { type: String, default: null, index: true },
    invoice_id: { type: String, default: null },
    subscription_external_id: { type: String, default: null },
    payment_status: { type: String, default: null },

    status: { type: String, enum: BILLING_EVENT_STATUSES, default: "received" },
    // failed + permanent: nothing a retry can turn into success; a human acts.
    permanent: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    error: { type: String, default: "" },
    steps: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Trimmed object: ids, status, amounts, customer. Never the whole payload.
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    credit_claim: { type: Boolean, default: false },
    // Set on rows synthesised by the reconcile job (unique_key "reconcile:<invoice>").
    synthetic: { type: Boolean, default: false },
    processing_started_at: { type: Date, default: null }
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, collection: "billing_events" }
);

// One wallet credit per invoice, whatever delivered the news. Partial so it
// only binds rows that hold the claim.
BillingEventSchema.index({ invoice_id: 1 }, { unique: true, partialFilterExpression: { credit_claim: true } });
BillingEventSchema.index({ status: 1, created_at: 1 });
// 180 days is plenty for audit and for the 45-day reconcile window.
BillingEventSchema.index({ created_at: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

const BillingEventModel = mongoose.model("BillingEvent", BillingEventSchema);

export default BillingEventModel;
