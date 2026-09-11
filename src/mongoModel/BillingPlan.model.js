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
    // Stripe. The Price this plan is sold as (price_…, per environment) and the
    // balance every paid invoice tops the wallet up TO. 0 = not sold via Stripe.
    // Lives here rather than in env so it is editable through the admin API
    // with no deploy. gtwy-ai's loader ignores both fields.
    stripe_price_id: {
      type: String,
      default: null
    },
    monthly_credits: {
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
