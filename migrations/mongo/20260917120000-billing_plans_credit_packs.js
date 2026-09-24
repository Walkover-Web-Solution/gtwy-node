/**
 * Migration: give each billing plan its extra-credit packs.
 *
 *   credit_packs — USD amounts an org on this plan can buy when its monthly
 *   allowance runs out. Seeded to the product's current offer, 10/20/50/100,
 *   only where the field is missing, so an admin edit survives a re-run. Change
 *   it afterwards with PUT /api/billing-plans; an empty list stops a plan
 *   offering any pack at all.
 *
 *   The number of CREDITS each pack carries is not stored anywhere: it is the
 *   amount divided by the org's credit rate, so the packs stay correctly priced
 *   in an environment whose rate differs.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */

const DEFAULT_CREDIT_PACKS_USD = [10, 20, 50, 100];

export const up = async (db) => {
  const plans = db.collection("billing_plans");
  const seeded = await plans.updateMany({ credit_packs: { $exists: false } }, { $set: { credit_packs: DEFAULT_CREDIT_PACKS_USD } });
  console.log(`[billing] credit_packs seeded to ${DEFAULT_CREDIT_PACKS_USD.join("/")} on ${seeded.modifiedCount} plan(s).`);
};

export const down = async (db) => {
  await db.collection("billing_plans").updateMany({}, { $unset: { credit_packs: "" } });
};
