/**
 * Drops the stale `name_1_org_id_1` unique index on `apikeycredentials`.
 *
 * The Mongoose schema (src/mongoModel/Api.model.js) has never declared this
 * compound unique index in code — only { org_id: 1, folder_id: 1 } is unique.
 * The name+org_id index exists only in the live database (created by an
 * earlier, no-longer-present version of the schema) and was rejecting
 * legitimate saves whenever an org has multiple API keys with the same
 * `name` (e.g. two "openai" keys in different folders), e.g.:
 *   E11000 duplicate key error ... index: name_1_org_id_1 dup key: { name: "openai", org_id: "20678" }
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
const COLLECTION = "apikeycredentials";
const INDEX_NAME = "name_1_org_id_1";

export const up = async (db) => {
  const collection = db.collection(COLLECTION);
  const indexes = await collection.indexes();
  if (!indexes.some((index) => index.name === INDEX_NAME)) {
    console.log(`[${COLLECTION}] index ${INDEX_NAME} not present, nothing to drop`);
    return;
  }
  await collection.dropIndex(INDEX_NAME);
  console.log(`[${COLLECTION}] dropped index ${INDEX_NAME}`);
};

export const down = async (db) => {
  const collection = db.collection(COLLECTION);
  await collection.createIndex({ name: 1, org_id: 1 }, { unique: true, name: INDEX_NAME });
  console.log(`[${COLLECTION}] recreated index ${INDEX_NAME}`);
};
