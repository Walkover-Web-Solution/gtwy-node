import mongoose from "mongoose";

// Every Stripe webhook event we have seen, and what we did with it. This is the
// durable idempotency layer: Stripe retries for up to 3 days and may deliver
// the same event more than once, so dedup cannot live in a Redis key with a
// TTL (the top-up claim in lago.service.js is 24h and fails open — unusable
// for money). Insert-first on event_id; the caller decides from the existing
// row's status what to do on a duplicate.
//
// steps.* are checkpoints inside one invoice.paid: credited -> plan_changed ->
// synced. A retry after a mid-flight crash resumes at the first unfinished
// step instead of repeating the credit.
const StripeEventSchema = new mongoose.Schema(
  {
    event_id: { type: String, required: true, unique: true },
    type: { type: String, required: true, index: true },
    livemode: { type: Boolean, default: false },
    api_version: { type: String, default: null },
    created: { type: Date, default: null },

    org_id: { type: String, default: null, index: true },
    invoice_id: { type: String, default: null },
    subscription_id: { type: String, default: null },

    status: { type: String, enum: ["received", "processing", "processed", "failed", "ignored"], default: "received" },
    // failed + permanent: nothing Stripe or the cron can retry into success; a human acts.
    permanent: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    error: { type: String, default: "" },
    steps: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Trimmed data.object: ids, status, amounts, metadata. Never the whole event.
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    processing_started_at: { type: Date, default: null }
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, collection: "stripe_events" }
);

// Two DIFFERENT event ids for the same paid invoice must not both credit the
// wallet. Partial so it only binds invoice.paid rows that carry an invoice id.
StripeEventSchema.index({ invoice_id: 1 }, { unique: true, partialFilterExpression: { type: "invoice.paid", invoice_id: { $type: "string" } } });
StripeEventSchema.index({ status: 1, created_at: 1 });
// 180 days is plenty for audit and for the 45-day reconcile window.
StripeEventSchema.index({ created_at: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

const StripeEventModel = mongoose.model("StripeEvent", StripeEventSchema);

export default StripeEventModel;
