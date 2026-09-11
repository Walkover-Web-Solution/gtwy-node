import mongoose from "mongoose";

// A debit Lago did not accept, kept so it can be replayed rather than lost.
// "failed" = rejected, safe to replay; "ambiguous" = no answer, check Lago first.
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
