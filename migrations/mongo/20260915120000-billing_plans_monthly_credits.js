/**
 * Migration: Stripe-through-Lago Pro subscription.
 *
 *   billing_plans.paid.monthly_credits — the balance every PAID subscription
 *   invoice tops the wallet up TO (8,000 credits for the $20 plan). Only set
 *   where missing, so an admin edit survives a re-run. The $20 fee itself lives
 *   on the Lago plan (Dashboard → Plans), not here.
 *
 *   billing_events — the Lago webhook ledger. The partial unique index on
 *   invoice_id (credit_claim: true) is what guarantees an invoice is credited
 *   once, so it is created here explicitly rather than left to Mongoose
 *   autoIndex on first boot. Names and specs match what Mongoose would build
 *   from the schema, so whichever side runs first, the other finds the index
 *   already there and moves on.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */

// createIndex, but "already exists" (same spec, any name; or same name) is fine.
const ensureIndex = async (collection, keys, options) => {
  try {
    await collection.createIndex(keys, options);
    return "created";
  } catch (err) {
    // 85 IndexOptionsConflict, 86 IndexKeySpecsConflict, or the driver's
    // "Index already exists with a different name" text.
    if (err?.code === 85 || err?.code === 86 || /already exists/i.test(err?.message || "")) return "exists";
    throw err;
  }
};

export const up = async (db) => {
  const plans = db.collection("billing_plans");
  const credits = await plans.updateOne({ plan_code: "paid", monthly_credits: { $exists: false } }, { $set: { monthly_credits: 8000 } });
  const zeroed = await plans.updateMany({ monthly_credits: { $exists: false } }, { $set: { monthly_credits: 0 } });

  const events = db.collection("billing_events");
  const results = [];
  results.push(["billing_events.unique_key_1", await ensureIndex(events, { unique_key: 1 }, { unique: true })]);
  results.push([
    "billing_events.invoice_id_1 (partial unique, credit_claim)",
    await ensureIndex(events, { invoice_id: 1 }, { unique: true, partialFilterExpression: { credit_claim: true } })
  ]);
  results.push(["billing_events.status_1_created_at_1", await ensureIndex(events, { status: 1, created_at: 1 }, {})]);
  results.push(["billing_events.created_at_1 (ttl 180d)", await ensureIndex(events, { created_at: 1 }, { expireAfterSeconds: 180 * 24 * 3600 })]);

  const orgs = db.collection("org_billings");
  results.push(["org_billings.org_id_1", await ensureIndex(orgs, { org_id: 1 }, { unique: true })]);
  results.push(["org_billings.status_1", await ensureIndex(orgs, { status: 1 }, {})]);

  console.log(
    `[billing] monthly_credits set to 8000 on ${credits.modifiedCount} paid plan(s), initialised to 0 on ${zeroed.modifiedCount} other(s); ` +
      `indexes: ${results.map(([name, state]) => `${name}=${state}`).join(", ")}`
  );
};

export const down = async (db) => {
  await db.collection("billing_plans").updateMany({}, { $unset: { monthly_credits: "" } });
  await db
    .collection("billing_events")
    .dropIndex("invoice_id_1")
    .catch(() => {});
};
