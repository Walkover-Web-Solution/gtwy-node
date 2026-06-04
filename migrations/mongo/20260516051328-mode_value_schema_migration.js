const transformToDbFormat = (configuration) => {
  if (!configuration || typeof configuration !== "object") return configuration;
  const transformed = {};
  let transformationCount = 0;
  for (const [key, value] of Object.entries(configuration)) {
    if (key === "prompt" || key === "model" || key === "type" || key === "system_prompt_version_id" || key === "is_rich_text") {
      transformed[key] = value;
      continue;
    }
    if (value && typeof value === "object" && "mode" in value) {
      transformed[key] = value;
      continue;
    }
    if (value === "default" || value === "min" || value === "max") {
      transformed[key] = { mode: value, value: null };
      transformationCount++;
    } else if (typeof value === "number") {
      transformed[key] = { mode: "custom", value: value };
      transformationCount++;
    } else if (value === null || value === undefined) {
      transformed[key] = { mode: "default", value: null };
      transformationCount++;
    } else {
      transformed[key] = { mode: "custom", value: value };
      transformationCount++;
    }
  }
  return { transformed, transformationCount };
};

const needsMigration = (configuration) => {
  if (!configuration || typeof configuration !== "object") return false;
  for (const value of Object.values(configuration)) {
    if (value && typeof value === "object" && "mode" in value) continue;
    else if (value !== undefined && value !== null) return true;
  }
  return false;
};

const transformToFrontendFormat = (configuration) => {
  if (!configuration || typeof configuration !== "object") return configuration;
  const transformed = {};
  for (const [key, value] of Object.entries(configuration)) {
    if (key === "prompt" || key === "model") {
      transformed[key] = value;
      continue;
    }
    if (value && typeof value === "object" && "mode" in value) {
      transformed[key] = value.mode === "custom" ? value.value : value.mode;
    } else {
      transformed[key] = value;
    }
  }
  return transformed;
};

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  console.log("[MIGRATION] Starting mode/value schema migration...");
  await migrateCollection(db, "configurations");
  await migrateCollection(db, "configuration_versions");
  console.log("[MIGRATION] Migration completed successfully!");
};

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  console.log("[MIGRATION] Rolling back mode/value schema migration...");
  await rollbackCollection(db, "configurations");
  await rollbackCollection(db, "configuration_versions");
  console.log("[MIGRATION] Rollback completed successfully!");
};

async function migrateCollection(db, collectionName) {
  console.log(`[MIGRATION] Migrating ${collectionName}...`);
  const collection = db.collection(collectionName);
  const cursor = collection.find({
    configuration: { $exists: true }
  });
  let totalProcessed = 0,
    totalMigrated = 0,
    totalTransformed = 0;
  const BULK_BATCH_SIZE = 500;
  let bulkOps = [];

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    totalProcessed++;
    const { _id, configuration } = doc;
    if (!needsMigration(configuration)) {
      if (totalProcessed % 100 === 0) {
        console.log(`[MIGRATION] ${collectionName}: Processed ${totalProcessed} documents (no migration needed)`);
      }
      continue;
    }
    const { transformed, transformationCount } = transformToDbFormat(configuration);
    if (transformationCount > 0) {
      bulkOps.push({
        updateOne: {
          filter: { _id },
          update: { $set: { configuration: transformed } }
        }
      });
      totalMigrated++;
      totalTransformed += transformationCount;
      console.log(`[MIGRATION] ${collectionName}: Document ${_id} - transformed ${transformationCount} params`);

      if (bulkOps.length >= BULK_BATCH_SIZE) {
        console.log(`[MIGRATION] ${collectionName}: Executing bulk write with ${bulkOps.length} operations...`);
        await collection.bulkWrite(bulkOps);
        bulkOps = [];
        console.log(
          `[MIGRATION] ${collectionName}: Bulk write completed. Progress - ${totalProcessed} processed, ${totalMigrated} migrated, ${totalTransformed} params transformed`
        );
      }
    }
    if (totalProcessed % 100 === 0) {
      console.log(
        `[MIGRATION] ${collectionName}: Progress - ${totalProcessed} processed, ${totalMigrated} migrated, ${totalTransformed} params transformed`
      );
    }
  }

  if (bulkOps.length > 0) {
    console.log(`[MIGRATION] ${collectionName}: Executing final bulk write with ${bulkOps.length} operations...`);
    await collection.bulkWrite(bulkOps);
    console.log(`[MIGRATION] ${collectionName}: Final bulk write completed`);
  }

  console.log(`[MIGRATION] ${collectionName}: COMPLETED - ${totalMigrated}/${totalProcessed} migrated, ${totalTransformed} params transformed`);
}

async function rollbackCollection(db, collectionName) {
  console.log(`[MIGRATION] Rolling back ${collectionName}...`);
  const collection = db.collection(collectionName);
  const cursor = collection.find({
    configuration: { $exists: true }
  });
  let totalProcessed = 0,
    totalRolledBack = 0;
  const BULK_BATCH_SIZE = 500;
  let bulkOps = [];

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    totalProcessed++;
    const { _id, configuration } = doc;
    let hasDbFormat = false;
    for (const value of Object.values(configuration)) {
      if (value && typeof value === "object" && "mode" in value && "value" in value) {
        hasDbFormat = true;
        break;
      }
    }
    if (!hasDbFormat) {
      if (totalProcessed % 100 === 0) {
        console.log(`[MIGRATION] ${collectionName}: Processed ${totalProcessed} documents (no rollback needed)`);
      }
      continue;
    }
    const transformed = transformToFrontendFormat(configuration);
    bulkOps.push({
      updateOne: {
        filter: { _id },
        update: { $set: { configuration: transformed } }
      }
    });
    totalRolledBack++;
    console.log(`[MIGRATION] ${collectionName}: Document ${_id} - rolled back`);

    if (bulkOps.length >= BULK_BATCH_SIZE) {
      console.log(`[MIGRATION] ${collectionName}: Executing bulk write with ${bulkOps.length} operations...`);
      await collection.bulkWrite(bulkOps);
      bulkOps = [];
      console.log(`[MIGRATION] ${collectionName}: Bulk write completed. Progress - ${totalProcessed} processed, ${totalRolledBack} rolled back`);
    }
    if (totalProcessed % 100 === 0) {
      console.log(`[MIGRATION] ${collectionName}: Progress - ${totalProcessed} processed, ${totalRolledBack} rolled back`);
    }
  }

  if (bulkOps.length > 0) {
    console.log(`[MIGRATION] ${collectionName}: Executing final bulk write with ${bulkOps.length} operations...`);
    await collection.bulkWrite(bulkOps);
    console.log(`[MIGRATION] ${collectionName}: Final bulk write completed`);
  }

  console.log(`[MIGRATION] ${collectionName}: COMPLETED - ${totalRolledBack}/${totalProcessed} rolled back`);
}
