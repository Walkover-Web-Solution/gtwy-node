import mongoose from "mongoose";
import { PLAN_SLUGS } from "../configs/billingPlans.js";

// One row per org that has ever touched Stripe: which Stripe customer and
// subscription belong to it, and a MIRROR of the subscription's state for the
// UI. Stripe is the truth for this data — every field here is rewritten from a
// fresh stripe.subscriptions.retrieve(), never from a webhook payload, so
// out-of-order deliveries cannot regress it. Lago remains the plan-of-record
// gtwy-ai reads; this collection never feeds the request gate.
const OrgBillingSchema = new mongoose.Schema(
  {
    org_id: { type: String, required: true, unique: true, index: true },

    stripe_customer_id: { type: String, default: null, unique: true, sparse: true },
    stripe_subscription_id: { type: String, default: null, index: true },
    stripe_price_id: { type: String, default: null },
    // What Stripe says the org bought (from subscription metadata we set at Checkout).
    plan_slug: { type: String, enum: [...PLAN_SLUGS, null], default: null },

    // Stripe subscription statuses, verbatim.
    status: {
      type: String,
      enum: ["none", "incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"],
      default: "none"
    },
    current_period_start: { type: Date, default: null },
    current_period_end: { type: Date, default: null },
    cancel_at_period_end: { type: Boolean, default: false },
    canceled_at: { type: Date, default: null },

    // An open Checkout Session is reused rather than duplicated (two tabs != two subscriptions).
    pending_checkout_session_id: { type: String, default: null },
    pending_checkout_expires_at: { type: Date, default: null },

    last_invoice_id: { type: String, default: null },
    last_paid_at: { type: Date, default: null },
    // Decimal string: how many credits the last paid invoice actually added.
    last_credit_delta: { type: String, default: null },
    last_payment_error: { type: mongoose.Schema.Types.Mixed, default: null },

    // A second live subscription on the same customer is recorded here and
    // alerted; ops resolves it. Never cancelled automatically.
    duplicate_subscription_ids: { type: [String], default: [] },

    initiated_by: { type: String, default: "" }
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, collection: "org_billings", strict: true }
);

const OrgBillingModel = mongoose.model("OrgBilling", OrgBillingSchema);

export default OrgBillingModel;
