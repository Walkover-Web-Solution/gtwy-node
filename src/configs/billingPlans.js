// Maps our plan SLUG to the Lago plan_code.
//
// The slug is the wire value: it goes into Mongo org_billing.plan and the
// nd_org_billing_plan_ Redis key, and gtwy-ai resolves it against the
// billing_plans collection. It must stay "free"/"paid" — billing_utils
// falls back to the most restrictive plan for a code it cannot resolve, so a
// slug gtwy-ai has never heard of silently restricts every org on it.
// "Pro" is a display_name, held in the billing_plans document, never here.
//
// plan_code is DEPLOY-TIME config: staging and prod point at different Lago
// plans, so it comes from env rather than the database.
//
// LAGO_PLAN_CODE_FREE is deliberately the pre-existing BILLING_EVENT_CODE
// value. Adopting the plan every org is already subscribed to means the
// two-plan rollout needs no per-org migration, no invoices and no risk.

export const DEFAULT_PLAN_SLUG = "free";

export const BILLING_PLANS = {
  free: { slug: "free", plan_code: process.env.LAGO_PLAN_CODE_FREE },
  paid: { slug: "paid", plan_code: process.env.LAGO_PLAN_CODE_PAID }
};

export const PLAN_SLUGS = Object.keys(BILLING_PLANS);

export const isPlanSlug = (slug) => Object.hasOwn(BILLING_PLANS, String(slug));

export const planCodeFor = (slug) => {
  const plan = BILLING_PLANS[String(slug)];
  if (!plan) throw new Error(`unknown billing plan slug '${slug}' — expected one of ${PLAN_SLUGS.join(", ")}`);
  if (!plan.plan_code) {
    throw new Error(
      `LAGO_PLAN_CODE_${String(slug).toUpperCase()} is not set — refusing to touch a Lago subscription ` + "without knowing which plan to put it on"
    );
  }
  return plan.plan_code;
};

// Lago plan_code -> our slug. null for a code we do not recognise, which is
// how reconcileOrgPlan reports an org sitting on a plan we did not create.
export const planSlugForCode = (plan_code) => {
  if (!plan_code) return null;
  const match = Object.values(BILLING_PLANS).find((p) => p.plan_code === plan_code);
  return match ? match.slug : null;
};

// Boot check: a missing plan code must fail at deploy, not at 2am on the first
// upgrade. Called from src/index.js.
export const assertBillingPlansConfigured = () => {
  const missing = PLAN_SLUGS.filter((slug) => !BILLING_PLANS[slug].plan_code);
  if (missing.length) {
    throw new Error(`Billing plan codes missing from env: ${missing.map((s) => `LAGO_PLAN_CODE_${s.toUpperCase()}`).join(", ")}`);
  }
};
