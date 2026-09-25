/**
 * Migration: cut the per-hit fee.
 *
 *   api / chatbot  $0.07 -> $0.009
 *   embed          $0.06 -> $0.006
 *
 * 20260916120000-billing_plans_hit_fees.js seeded $0.07 / $0.07 / $0.06 onto
 * every plan. That migration is left as it was (it has already run in some
 * environments); this one moves the rates on, so a fresh environment runs both
 * and ends up at the new prices.
 *
 * Field by field, and only where the value is still the OLD default: a rate an
 * admin set through PUT /api/billing-plans (Enterprise on its own price, say) is
 * a deliberate choice and is left alone.
 *
 * At LAGO_CREDIT_RATE_USD = 0.0025 a hit now costs 3.6 credits (embed 2.4)
 * instead of 28 (embed 24). gtwy-ai reads billing_plans live, so the new rate
 * applies without a restart.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */

const PRICE_CUT = [
  { kind: "api", from: 0.07, to: 0.009 },
  { kind: "chatbot", from: 0.07, to: 0.009 },
  { kind: "embed", from: 0.06, to: 0.006 }
];

const move = async (db, direction) => {
  const plans = db.collection("billing_plans");
  const results = [];
  for (const { kind, from, to } of PRICE_CUT) {
    const [oldRate, newRate] = direction === "up" ? [from, to] : [to, from];
    const result = await plans.updateMany({ [`hit_fees.${kind}`]: oldRate }, { $set: { [`hit_fees.${kind}`]: newRate } });
    results.push(`${kind} $${oldRate} -> $${newRate} on ${result.modifiedCount} plan(s)`);
  }
  return results;
};

export const up = async (db) => {
  const results = await move(db, "up");
  console.log(`billing_plans hit_fees: ${results.join("; ")}. Plans on any other rate were left alone.`);
};

export const down = async (db) => {
  const results = await move(db, "down");
  console.log(`billing_plans hit_fees reverted: ${results.join("; ")}.`);
};
