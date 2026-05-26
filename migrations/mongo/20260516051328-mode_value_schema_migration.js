import { modelConfigDocument } from "../../src/services/utils/loadModelConfigs.js";

const getAdvancedParamKeys = (service, model) => {
  if (!service || !model) return new Set();
  const serviceLower = service.toLowerCase();
  const modelConfig = modelConfigDocument[serviceLower]?.[model];
  if (!modelConfig) return new Set();
  const advancedKeys = new Set();
  const config = modelConfig.configuration || {};
  for (const key of Object.keys(config)) {
    if (key === "model") continue;
    advancedKeys.add(key);
  }
  return advancedKeys;
};

const transformToDbFormat = (configuration, service, model) => {
  if (!configuration || typeof configuration !== "object") return configuration;
  const advancedKeys = getAdvancedParamKeys(service, model);
  const transformed = {};
  let transformationCount = 0;
  for (const [key, value] of Object.entries(configuration)) {
    if (!advancedKeys.has(key)) {
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

const needsMigration = (configuration, service, model) => {
  if (!configuration || !service || !model) return false;
  const advancedKeys = getAdvancedParamKeys(service, model);
  for (const key of advancedKeys) {
    const value = configuration[key];
    if (value && typeof value === "object" && "mode" in value) continue;
    else if (value !== undefined && value !== null) return true;
  }
  return false;
};

const transformToFrontendFormat = (configuration, service, model) => {
  if (!configuration || typeof configuration !== "object") return configuration;
  const advancedKeys = getAdvancedParamKeys(service, model);
  const transformed = {};
  for (const [key, value] of Object.entries(configuration)) {
    if (advancedKeys.has(key) && value && typeof value === "object" && "mode" in value) {
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
    configuration: { $exists: true },
    service: { $exists: true },
    "configuration.model": { $exists: true }
  });
  let totalProcessed = 0,
    totalMigrated = 0,
    totalTransformed = 0;
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    totalProcessed++;
    const { _id, service, configuration } = doc;
    const model = configuration?.model;
    if (!service || !model) continue;
    if (!needsMigration(configuration, service, model)) continue;
    const { transformed, transformationCount } = transformToDbFormat(configuration, service, model);
    if (transformationCount > 0) {
      await collection.updateOne({ _id }, { $set: { configuration: transformed } });
      totalMigrated++;
      totalTransformed += transformationCount;
    }
  }
  console.log(`[MIGRATION] ${collectionName}: ${totalMigrated}/${totalProcessed} migrated, ${totalTransformed} params transformed`);
}

async function rollbackCollection(db, collectionName) {
  console.log(`[MIGRATION] Rolling back ${collectionName}...`);
  const collection = db.collection(collectionName);
  const cursor = collection.find({
    configuration: { $exists: true },
    service: { $exists: true },
    "configuration.model": { $exists: true }
  });
  let totalProcessed = 0,
    totalRolledBack = 0;
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    totalProcessed++;
    const { _id, service, configuration } = doc;
    const model = configuration?.model;
    if (!service || !model) continue;
    let hasDbFormat = false;
    for (const value of Object.values(configuration)) {
      if (value && typeof value === "object" && "mode" in value && "value" in value) {
        hasDbFormat = true;
        break;
      }
    }
    if (!hasDbFormat) continue;
    const transformed = transformToFrontendFormat(configuration, service, model);
    await collection.updateOne({ _id }, { $set: { configuration: transformed } });
    totalRolledBack++;
  }
  console.log(`[MIGRATION] ${collectionName}: ${totalRolledBack}/${totalProcessed} rolled back`);
}
