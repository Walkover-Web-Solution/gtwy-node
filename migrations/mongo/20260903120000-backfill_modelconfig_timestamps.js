/**
 * Backfill created_at / updated_at on modelconfigurations from ObjectId time.
 *
 * Existing docs were created before timestamps were enabled on ModelConfig.
 * ObjectId embeds creation time in the first 4 bytes; use that for both fields
 * so sorting by created_at matches historical insert order.
 *
 * Only updates docs missing created_at or updated_at.
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */

function timestampFromObjectId(id) {
  if (!id) return null;
  if (typeof id.getTimestamp === "function") {
    return id.getTimestamp();
  }
  const hex = String(id);
  if (!/^[a-fA-F0-9]{24}$/.test(hex)) return null;
  return new Date(parseInt(hex.slice(0, 8), 16) * 1000);
}

export const up = async (db) => {
  const modelConfigs = db.collection("modelconfigurations");
  const cursor = modelConfigs.find({
    $or: [{ created_at: { $exists: false } }, { updated_at: { $exists: false } }, { created_at: null }, { updated_at: null }]
  });

  let updated = 0;
  let skipped = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const ts = timestampFromObjectId(doc._id);
    if (!ts) {
      skipped += 1;
      console.warn(`[modelconfigurations] Skip ${doc._id}: could not derive timestamp from ObjectId`);
      continue;
    }

    const $set = {};
    if (doc.created_at == null) $set.created_at = ts;
    if (doc.updated_at == null) $set.updated_at = ts;
    if (Object.keys($set).length === 0) continue;

    await modelConfigs.updateOne({ _id: doc._id }, { $set });
    updated += 1;
  }

  console.log(`[modelconfigurations] Backfilled timestamps on ${updated} doc(s); skipped ${skipped}.`);
};

export const down = async (db) => {
  const modelConfigs = db.collection("modelconfigurations");
  const res = await modelConfigs.updateMany({}, { $unset: { created_at: "", updated_at: "" } });
  console.log(`[modelconfigurations] Removed created_at/updated_at from ${res.modifiedCount} doc(s).`);
};
