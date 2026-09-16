/**
 * Migration: move the per-hit fee from env onto each billing plan.
 *
 * It was GTWY_HIT_FEE_USD / GTWY_EMBED_HIT_FEE_USD, one pair of numbers for the
 * whole platform. A per-plan field is what lets Enterprise land on a lower rate
 * with one API call instead of a deploy.
 *
 * Seeds the rates the env vars were meant to carry ($0.07 a hit, $0.06 for
 * embed) onto BOTH existing plans, so behaviour after this is what the env was
 * always supposed to produce. Only sets where the field is missing, so an admin
 * edit survives a re-run. A plan with no hit_fees charges nothing.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */

const DEFAULT_HIT_FEES = { api: 0.07, chatbot: 0.07, embed: 0.06 };

export const up = async (db) => {
  const result = await db.collection("billing_plans").updateMany({ hit_fees: { $exists: false } }, { $set: { hit_fees: DEFAULT_HIT_FEES } });
  console.log(
    `billing_plans: hit_fees seeded on ${result.modifiedCount} plan(s) ` +
      `(api $${DEFAULT_HIT_FEES.api}, chatbot $${DEFAULT_HIT_FEES.chatbot}, embed $${DEFAULT_HIT_FEES.embed}). ` +
      "Change a plan's rates with PUT /api/billing-plans; GTWY_HIT_FEE_USD / GTWY_EMBED_HIT_FEE_USD are no longer read."
  );
};

export const down = async (db) => {
  await db.collection("billing_plans").updateMany({}, { $unset: { hit_fees: "" } });
};
