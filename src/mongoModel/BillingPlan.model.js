import mongoose from "mongoose";

// One document per billing plan. This is the EDITABLE definition of what a plan
// includes — it replaces the `free_tier` boolean that was spread across hundreds
// of modelconfigurations documents with no reachable admin API.
//
// `services` is an allowlist:
//   "*"                          -> every service, every model
//   { neev_cloud: "*" }          -> every model of neev_cloud, including future ones
//   { open_router: ["a","b"] }   -> only those exact model_name values
//   a service key that is absent -> that service is DENIED
// Model names are `modelconfigurations.model_name` verbatim and case-sensitive;
// service keys are the `service` field verbatim. Mixed is deliberate — Mongoose
// cannot type "string or object or array of strings", and Python normalises and
// validates the shape at load time (src/services/utils/load_plan_configs.py).
//
// `plan_code` is our SLUG and must stay "free" / "paid": Python hardcodes that
// tuple in billing_utils.get_org_plan and coerces anything else to "free", so a
// new slug would silently restrict paying orgs. "Pro" is display_name only, and
// must never reach Mongo's org_billing.plan or the Redis plan key.
// The LAGO plan_code is separate deploy-time config (LAGO_PLAN_CODE_FREE /
// LAGO_PLAN_CODE_PAID) because it differs between staging and prod.
//
// Python reads this collection live via a change stream, so edits take effect
// without a deploy. snake_case matches the other billing collections and the
// Python side, deliberately against the repo-wide camelCase convention.
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
    // Credits granted ONCE, at wallet creation, by lago.service.createWallet.
    // Never granted on a plan change — that would make free->paid->free a
    // credit printing press.
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
