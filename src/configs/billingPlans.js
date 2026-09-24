// Maps our plan slug ("free"/"paid", the value shared with gtwy-ai and Redis)
// to the Lago plan_code, which is per-environment and so comes from env.

export const DEFAULT_PLAN_SLUG = "free";

export const BILLING_PLANS = {
  free: { slug: "free", plan_code: process.env.LAGO_PLAN_CODE_FREE },
  paid: { slug: "paid", plan_code: process.env.LAGO_PLAN_CODE_PAID }
};

export const PLAN_SLUGS = Object.keys(BILLING_PLANS);

// The Lago plan_code for a slug. Throws on an unknown slug or an unset env var.
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

// Lago plan_code -> our slug, or null for a code we did not create.
export const planSlugForCode = (plan_code) => {
  if (!plan_code) return null;
  const match = Object.values(BILLING_PLANS).find((p) => p.plan_code === plan_code);
  return match ? match.slug : null;
};

// Boot check: a missing plan code must fail at deploy, not at the first upgrade.
export const assertBillingPlansConfigured = () => {
  const missing = PLAN_SLUGS.filter((slug) => !BILLING_PLANS[slug].plan_code);
  if (missing.length) {
    throw new Error(`Billing plan codes missing from env: ${missing.map((s) => `LAGO_PLAN_CODE_${s.toUpperCase()}`).join(", ")}`);
  }
};
