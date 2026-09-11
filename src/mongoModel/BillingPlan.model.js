import mongoose from "mongoose";

// One editable document per billing plan. `services` is an allowlist: "*", or a
// map of service -> "*" | [model_name], where an absent service is denied.
// gtwy-ai reads this collection live, so edits take effect without a deploy.
const BillingPlanSchema = new mongoose.Schema(
  {
    plan_code: {
      type: String,
      required: true,
      unique: true
    },
    display_name: {
      type: String,
      required: true
    },
    services: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    // Granted once, at wallet creation — never on a plan change.
    credit_grant: {
      type: Number,
      default: 0
    },
    status: {
      type: Number,
      default: 1
    },
    updated_by: {
      type: String,
      default: ""
    }
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, collection: "billing_plans" }
);

const BillingPlanModel = mongoose.model("BillingPlan", BillingPlanSchema, "billing_plans");

export default BillingPlanModel;
