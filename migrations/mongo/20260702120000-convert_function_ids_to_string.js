/**
 * Migration: Convert function_ids array elements to string format
 * in both `configuration` (agents/bridges) and `configuration_versions` (versions) collections.
 *
 * Historically these were stored as a mix of ObjectId and string. This migration normalizes
 * everything to strings so downstream queries can consistently rely on string equality.
 */

export const up = async (db) => {
  console.log("=== Starting convert_function_ids_to_string migration ===");

  const collections = [
    { name: "configurations", label: "agents (configuration)" },
    { name: "configuration_versions", label: "versions (configuration_versions)" }
  ];

  for (const { name, label } of collections) {
    console.log(`\n[${label}] Processing...`);
    const coll = db.collection(name);

    // Only fetch docs that have at least one ObjectId element in function_ids
    const cursor = coll.find({ function_ids: { $elemMatch: { $type: "objectId" } } });

    let processed = 0;
    let modified = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();

      if (!Array.isArray(doc.function_ids) || doc.function_ids.length === 0) {
        processed += 1;
        continue;
      }

      const normalized = doc.function_ids.filter((id) => id !== null && id !== undefined).map((id) => (typeof id === "string" ? id : id.toString()));

      const isDifferent = normalized.length !== doc.function_ids.length || normalized.some((id, idx) => id !== doc.function_ids[idx]);

      if (isDifferent) {
        await coll.updateOne({ _id: doc._id }, { $set: { function_ids: normalized } });
        modified += 1;
      }

      processed += 1;

      if (processed % 500 === 0) {
        console.log(`[${label}] Processed ${processed} docs so far, modified ${modified}...`);
      }
    }

    console.log(`[${label}] Done. Processed ${processed} docs, modified ${modified}.`);
  }

  console.log("\n=== Migration completed successfully ===");
};

export const down = async () => {
  // Non-reversible: we don't know the original types per element.
  console.log("Down migration is a no-op: converting strings back to ObjectId is not safe/lossless.");
};
