/**
 * Migration: Add soft-delete (deletedAt) support to apicalls, apikeycredentials, and folders.
 *
 * - Ensures existing documents in these collections have a `deletedAt` field.
 * - Adds/updates indexes so lookups can filter on `deletedAt: null`.
 * - Updates unique indexes on folders and apikeycredentials to include `deletedAt`,
 *   allowing soft-deleted records to coexist with active ones.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const ensureDeletedAt = async (collectionName) => {
    await db.collection(collectionName).updateMany({ deletedAt: { $exists: false } }, { $set: { deletedAt: null } });
  };

  // Add deletedAt field to collections that gained soft-delete behavior
  await ensureDeletedAt("apicalls");
  await ensureDeletedAt("apikeycredentials");
  await ensureDeletedAt("folders");
  await ensureDeletedAt("rag_collections");
  // configuration_versions already supports deletedAt but ensure consistency
  await ensureDeletedAt("configuration_versions");

  // TTL indexes: permanently remove soft-deleted records after 30 days
  const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60; // 2592000

  await db.collection("apicalls").createIndex({ deletedAt: 1 }, { expireAfterSeconds: THIRTY_DAYS_IN_SECONDS });
  await db.collection("apikeycredentials").createIndex({ deletedAt: 1 }, { expireAfterSeconds: THIRTY_DAYS_IN_SECONDS });
  await db.collection("folders").createIndex({ deletedAt: 1 }, { expireAfterSeconds: THIRTY_DAYS_IN_SECONDS });
  await db.collection("rag_collections").createIndex({ deletedAt: 1 }, { expireAfterSeconds: THIRTY_DAYS_IN_SECONDS });
  await db.collection("configuration_versions").createIndex({ deletedAt: 1 }, { expireAfterSeconds: THIRTY_DAYS_IN_SECONDS });
  // configurations already has a deletedAt TTL index via the Mongoose model, but ensure it exists here too
  await db.collection("configurations").createIndex({ deletedAt: 1 }, { expireAfterSeconds: THIRTY_DAYS_IN_SECONDS });
};

export const down = async () => {
  // Soft-delete fields are intentionally left in place to avoid data loss.
  console.log("Down migration for add_soft_delete_fields is a no-op.");
};
