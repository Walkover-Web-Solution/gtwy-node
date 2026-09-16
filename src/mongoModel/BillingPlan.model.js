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
    // The balance every PAID subscription invoice tops the wallet up TO (the
    // "8,000 credits a month" of the Pro plan). 0 = the plan grants nothing per
    // cycle. Lives here rather than in env so it is editable through the admin
    // API with no deploy. gtwy-ai's loader ignores it.
    monthly_credits: {
      type: Number,
      default: 0
    },
    // Flat USD charged once per HIT on this plan, on top of the model cost and
    // the commission, keyed by the kind of hit: { api, chatbot, embed }. Lives
    // here rather than in env so a new plan (Enterprise on a lower rate) is one
    // API call with no deploy. A kind that is absent or 0 is not charged, and a
    // plan with no hit_fees at all charges nothing. gtwy-ai reads this
    // collection live and does the charging.
    hit_fees: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
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
