/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const configurations = db.collection("configurations");
  const versions = db.collection("configuration_versions");

  const processCollection = async (collection, label) => {
    const docs = await collection.find({ settings: { $exists: true } }).toArray();
    const ops = [];
    let skipped = 0;
    let cleaned = 0;

    for (const doc of docs) {
      const settings = doc.settings || {};

      const unsetOp = {};
      if (settings.tonePrompt !== undefined) unsetOp["settings.tonePrompt"] = "";
      if (settings.responseStylePrompt !== undefined) unsetOp["settings.responseStylePrompt"] = "";

      if (Object.keys(unsetOp).length === 0) {
        skipped++;
        continue;
      }

      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $unset: unsetOp }
        }
      });
      cleaned++;
    }

    if (ops.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < ops.length; i += batchSize) {
        await collection.bulkWrite(ops.slice(i, i + batchSize));
        console.log(`[${label}] Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(ops.length / batchSize)}`);
      }
    }

    console.log(`[${label}] Scanned: ${docs.length}, Cleaned: ${cleaned}, Skipped: ${skipped}`);
  };

  console.log("\n=== CLEANING tonePrompt / responseStylePrompt ===");
  await processCollection(configurations, "configurations");
  await processCollection(versions, "configuration_versions");
  console.log("=== DONE ===");
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async () => {
  console.log("No rollback defined — tonePrompt/responseStylePrompt values cannot be recovered.");
};
