import mongoose from "mongoose";

// A debit Lago did not accept. The log-queue message is acked before we know
// the outcome, so without this store a failed charge simply vanished. Rows
// are replayed via POST /api/lago/debits/replay (InternalAuth).
// status:
//   "failed"    → Lago answered with an error; the event was NOT ingested —
//                 safe to replay automatically.
//   "ambiguous" → no answer (timeout/network); the event MAY have landed and
//                 Lago does not dedup event resends — replay only after
//                 checking Lago manually.
//   "replayed"  → successfully re-posted.
const FailedBillingDebitSchema = new mongoose.Schema(
  {
    transaction_id: { type: String, required: true, unique: true },
    org_id: { type: String, required: true },
    event: { type: mongoose.Schema.Types.Mixed, required: true },
    error: { type: String, default: "" },
    status: { type: String, enum: ["failed", "ambiguous", "replayed"], default: "failed" },
    attempts: { type: Number, default: 0 },
    replayed_at: { type: Date, default: null }
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, collection: "failed_billing_debits" }
);

FailedBillingDebitSchema.index({ status: 1, created_at: 1 });

const FailedBillingDebitModel = mongoose.model("FailedBillingDebit", FailedBillingDebitSchema);

export default FailedBillingDebitModel;
