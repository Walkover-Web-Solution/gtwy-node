/**
 * Migration: let blocked_orgs hold user blocks next to org blocks.
 *
 *   A row with user_id null blocks the whole org; a row with a user_id blocks
 *   only that user inside the org. The old schema had org_id { unique: true },
 *   so a second row for the same org (any user block, or a user block in a
 *   blocked org) failed with E11000. Mongoose never drops an index that left the
 *   schema, so `org_id_1` is dropped here and replaced by a unique
 *   { org_id, user_id } index plus a plain org_id index for lookups.
 *
 *   Existing rows have no user_id field; a unique index treats a missing field
 *   as null, so they keep acting as one org-level row per org.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */

const OLD_INDEX = "org_id_1";

const listIndexes = async (collection) =>
  collection.indexes().catch((err) => {
    // 26 NamespaceNotFound: the collection does not exist yet.
    if (err?.code === 26) return [];
    throw err;
  });

export const up = async (db) => {
  const blocked = db.collection("blocked_orgs");
  const indexes = await listIndexes(blocked);
  const old = indexes.find((index) => index.name === OLD_INDEX);
  if (old?.unique) {
    await blocked.dropIndex(OLD_INDEX);
    console.log(`[blocked_orgs] dropped unique index ${OLD_INDEX}`);
  }
  await blocked.createIndex({ org_id: 1 });
  await blocked.createIndex({ org_id: 1, user_id: 1 }, { unique: true });
  console.log("[blocked_orgs] ensured org_id_1 and unique org_id_1_user_id_1 indexes");
};

export const down = async (db) => {
  const blocked = db.collection("blocked_orgs");
  await blocked.deleteMany({ user_id: { $ne: null } });
  const indexes = await listIndexes(blocked);
  if (indexes.some((index) => index.name === "org_id_1_user_id_1")) await blocked.dropIndex("org_id_1_user_id_1");
  if (indexes.some((index) => index.name === OLD_INDEX)) await blocked.dropIndex(OLD_INDEX);
  await blocked.createIndex({ org_id: 1 }, { unique: true });
};
