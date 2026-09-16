import mongoose from "mongoose";

// One row per org that has ever started a Stripe checkout. Lago is the source
// of truth for the customer, the card, the subscription and every invoice; this
// row is a SLIM state machine for the UI banner and for the failed-payment grace
// timer, which Lago does not run for us (payment retries/dunning are a Lago
// premium feature). Lago remains the plan-of-record gtwy-ai reads; this
// collection never feeds the request gate.
//
//   none ─> awaiting_card ─> pending_first_payment ─> active <─> past_due
//                                     │                  │           │
//                                     └─> card_failed    └─> canceled└─> (free, via downgradeNow)
export const ORG_BILLING_STATUSES = ["none", "awaiting_card", "pending_first_payment", "active", "past_due", "canceled", "card_failed"];

const OrgBillingSchema = new mongoose.Schema(
  {
    org_id: { type: String, required: true, unique: true, index: true },

    status: { type: String, enum: ORG_BILLING_STATUSES, default: "none" },

    // Mirror of the Lago customer's provider link (filled from webhooks / GET /customers).
    lago_customer_id: { type: String, default: null },
    stripe_customer_id: { type: String, default: null },
    payment_provider_code: { type: String, default: null },
    // Best signal Lago gives us that a card is on file (a paid invoice, or the
    // provider link present). Lago does not expose the stored payment method.
    has_payment_method: { type: Boolean, default: false },

    subscription_external_id: { type: String, default: null },
    current_period_start: { type: Date, default: null },
    current_period_end: { type: Date, default: null },
    cancel_at_period_end: { type: Boolean, default: false },
    // When we moved the org onto paid via /subscribe — a failure within the
    // first hour of this with no paid invoice yet is a FIRST-payment failure.
    plan_activated_at: { type: Date, default: null },

    // The subscription invoice we are waiting on (unpaid), if any.
    open_invoice_id: { type: String, default: null },
    open_invoice_number: { type: String, default: null },
    // Renewal failed: keep Pro and retry daily until this; then downgrade.
    grace_until: { type: Date, default: null },
    last_retry_at: { type: Date, default: null },
    retry_count: { type: Number, default: 0 },

    last_paid_invoice_id: { type: String, default: null },
    last_paid_at: { type: Date, default: null },
    // Decimal string: how many credits the last paid invoice actually added.
    last_credit_delta: { type: String, default: null },
    last_payment_error: { type: mongoose.Schema.Types.Mixed, default: null },
    // 3DS: where the customer must go to complete the payment, while pending.
    requires_action_url: { type: String, default: null },

    initiated_by: { type: String, default: "" },
    // Loop guard: the last Lago subscription mutation WE made, so webhook
    // handlers that see the resulting subscription.started/terminated only mirror.
    last_plan_change_by: { type: String, default: null },
    last_plan_change_at: { type: Date, default: null }
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, collection: "org_billings", strict: true }
);

OrgBillingSchema.index({ status: 1 });
OrgBillingSchema.index({ grace_until: 1 }, { sparse: true });

const OrgBillingModel = mongoose.model("OrgBilling", OrgBillingSchema);

export default OrgBillingModel;
