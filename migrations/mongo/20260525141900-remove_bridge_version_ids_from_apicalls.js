export const up = async (db) => {
  console.log("=== Starting remove_bridge_version_ids_from_apicalls migration ===");

  console.log("[Step 1] Acquiring apicalls collection handle...");
  const apicallCollection = db.collection("apicalls");

  console.log("[Step 2] Removing bridge_ids and version_ids fields from all apicalls...");
  const result = await apicallCollection.updateMany(
    {},
    {
      $unset: {
        bridge_ids: "",
        version_ids: ""
      }
    }
  );

  console.log(`[Step 2] Done. Matched ${result.matchedCount} apicalls, modified ${result.modifiedCount} apicalls`);

  console.log("=== Migration completed successfully ===");
};

export const down = async (db) => {
  console.log("=== Starting rollback of remove_bridge_version_ids_from_apicalls migration ===");

  console.log("[Rollback Step 1] Acquiring apicalls collection handle...");
  const apicallCollection = db.collection("apicalls");

  console.log("[Rollback Step 2] Re-adding bridge_ids and version_ids fields to all apicalls...");
  const result = await apicallCollection.updateMany(
    {},
    {
      $set: {
        bridge_ids: [],
        version_ids: []
      }
    }
  );

  console.log(`[Rollback Step 2] Done. Matched ${result.matchedCount} apicalls, modified ${result.modifiedCount} apicalls`);

  console.log("=== Rollback completed successfully ===");
};
