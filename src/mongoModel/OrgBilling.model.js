import mongoose from "mongoose";

// One row per org: which billing plan it is on.
// "free"  → wallet-paid agents may only use models flagged free_tier
// "paid"  → unrestricted (flipped by the first successful wallet top-up)
// Python reads this collection (and the nd_org_billing_plan_ Redis key we
// keep in sync) on the request hot path — collection name is explicit so the
// two repos never disagree about pluralization.
const OrgBillingSchema = new mongoose.Schema(
  {
    org_id: {
      type: String,
      required: true,
      unique: true
    },
    plan: {
      type: String,
      enum: ["free", "paid"],
      default: "free"
    },
    upgraded_at: {
      type: Date,
      default: null
    }
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, collection: "org_billing" }
);

const OrgBillingModel = mongoose.model("OrgBilling", OrgBillingSchema);

export default OrgBillingModel;
