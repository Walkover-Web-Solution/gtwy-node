/**
 * Migration: drop the stale unique index on org_billings.stripe_customer_id.
 *
 *   The direct-Stripe build (superseded by the Lago one) declared
 *   stripe_customer_id as { unique: true, sparse: true }, and Mongoose autoIndex
 *   built `stripe_customer_id_1` wherever it ran. The current schema has no index
 *   there, but Mongoose never drops an index that left the schema, so it stayed.
 *
 *   It breaks every org after the first: the schema defaults the field to null,
 *   and `sparse` only skips documents where the field is MISSING, not null. The
 *   second org_billings row with stripe_customer_id: null fails its upsert with
 *   E11000, and every Lago webhook for that org (subscription.started/terminated,
 *   ...) retries into the same error.
 *
 *   Nothing needs this index — rows are always looked up by org_id — so it is
 *   dropped rather than rebuilt as a partial index.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */

const INDEX_NAME = "stripe_customer_id_1";

export const up = async (db) => {
  const orgs = db.collection("org_billings");
  const indexes = await orgs.indexes().catch((err) => {
    // 26 NamespaceNotFound: the collection does not exist yet, so neither does the index.
    if (err?.code === 26) return [];
    throw err;
  });
  if (!indexes.some((index) => index.name === INDEX_NAME)) {
    console.log(`[billing] org_billings.${INDEX_NAME} not present; nothing to drop`);
    return;
  }
  await orgs.dropIndex(INDEX_NAME);
  console.log(`[billing] dropped stale unique index org_billings.${INDEX_NAME}`);
};

// Not recreated: the index is what caused the E11000 failures.
export const down = async () => {};
