/**
 * Migration: give the `paid` billing plan its Stripe fields.
 *
 *   monthly_credits  — the balance every paid invoice tops the wallet up TO
 *                      (8,000 = $20 at $0.0025/credit). Only set where missing,
 *                      so an admin edit survives a re-run.
 *   stripe_price_id  — per environment (price_test_… vs price_live_…), so it is
 *                      NOT seeded here. Set it with PUT /api/billing-plans after
 *                      creating the Price in the Stripe Dashboard. Until then
 *                      checkout and invoice.paid fail loudly (transient), never
 *                      silently.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */

export const up = async (db) => {
  const plans = db.collection("billing_plans");
  const credits = await plans.updateOne({ plan_code: "paid", monthly_credits: { $exists: false } }, { $set: { monthly_credits: 8000 } });
  const price = await plans.updateMany({ stripe_price_id: { $exists: false } }, { $set: { stripe_price_id: null } });
  console.log(
    `billing_plans: monthly_credits set on ${credits.modifiedCount} plan(s), stripe_price_id initialised on ${price.modifiedCount}. ` +
      "Set the paid plan's stripe_price_id via PUT /api/billing-plans."
  );
};

export const down = async (db) => {
  await db.collection("billing_plans").updateMany({}, { $unset: { monthly_credits: "", stripe_price_id: "" } });
};
