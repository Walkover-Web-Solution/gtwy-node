/**
 * Cleans up `apikeycredentials` indexes to match the current schema
 * (src/mongoModel/Api.model.js), which declares no unique index at all.
 *
 * The live collection still had two more legacy indexes involving `name`
 * (from a schema version that no longer exists in code, and that included a
 * `deletedAt` soft-delete field the current ApikeyCredentials code never
 * sets or reads):
 *   - name_1_org_id_1_folder_id_1              (unique, no deletedAt)
 *   - name_1_org_id_1_folder_id_1_deletedAt_1   (unique, with deletedAt)
 * Both reject legitimate saves whenever an org has multiple API keys with
 * the same `name` in the same folder, e.g.:
 *   E11000 duplicate key error ... index: name_1_org_id_1_folder_id_1 dup key: { name: "openai", org_id: "20678", folder_id: "" }
 *
 * NOTE: an earlier version of this migration also tried to create a
 * { org_id: 1, folder_id: 1 } unique index (matching what the schema used to
 * declare). That failed — real orgs (e.g. org_id "10074") already have
 * multiple keys sharing folder_id: "" — so that requirement was dropped from
 * both the schema and this migration rather than forcing a data cleanup.
 *
 * The `deletedAt_1` TTL index is left alone here — unrelated to this bug,
 * and untouched pending confirmation it's safe to drop.
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
const COLLECTION = "apikeycredentials";
const STALE_INDEXES = ["name_1_org_id_1_folder_id_1", "name_1_org_id_1_folder_id_1_deletedAt_1"];

export const up = async (db) => {
  const collection = db.collection(COLLECTION);
  const indexes = await collection.indexes();
  const existingNames = new Set(indexes.map((index) => index.name));

  for (const indexName of STALE_INDEXES) {
    if (!existingNames.has(indexName)) {
      console.log(`[${COLLECTION}] index ${indexName} not present, nothing to drop`);
      continue;
    }
    await collection.dropIndex(indexName);
    console.log(`[${COLLECTION}] dropped index ${indexName}`);
  }
};

export const down = async (db) => {
  const collection = db.collection(COLLECTION);
  await collection.createIndex({ name: 1, org_id: 1, folder_id: 1 }, { unique: true, name: STALE_INDEXES[0] });
  await collection.createIndex({ name: 1, org_id: 1, folder_id: 1, deletedAt: 1 }, { unique: true, name: STALE_INDEXES[1] });
  console.log(`[${COLLECTION}] recreated legacy name-based indexes`);
};
