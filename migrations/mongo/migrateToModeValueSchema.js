import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { modelConfigDocument } from "../services/utils/loadModelConfigs.js";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_URI;
if (!MONGODB_URI) {
  console.error("Error: MONGODB_CONNECTION_URI environment variable is not set.");
  process.exit(1);
}

/**
 * Get advanced parameter keys for a service/model combination
 */
const getAdvancedParamKeys = (service, model) => {
  if (!service || !model) return new Set();

  const serviceLower = service.toLowerCase();
  const modelConfig = modelConfigDocument[serviceLower]?.[model];
  if (!modelConfig) {
    console.log(`[MIGRATION] No model config found for ${serviceLower}/${model}`);
    return new Set();
  }

  const advancedKeys = new Set();
  const config = modelConfig.configuration || {};

  for (const key of Object.keys(config)) {
    if (key === "model") continue;
    advancedKeys.add(key);
  }

  return advancedKeys;
};

/**
 * Transform configuration to DB format (mode/value structure)
 */
const transformToDbFormat = (configuration, service, model) => {
  if (!configuration || typeof configuration !== "object") {
    return configuration;
  }

  const advancedKeys = getAdvancedParamKeys(service, model);
  const transformed = {};
  let transformationCount = 0;

  for (const [key, value] of Object.entries(configuration)) {
    // Skip non-advanced parameters - store as-is
    if (!advancedKeys.has(key)) {
      transformed[key] = value;
      continue;
    }

    // If already in DB format (has mode property), keep as-is
    if (value && typeof value === "object" && "mode" in value) {
      transformed[key] = value;
      continue;
    }

    // Transform to DB format based on value type
    if (value === "default" || value === "min" || value === "max") {
      transformed[key] = {
        mode: value,
        value: null
      };
      transformationCount++;
    } else if (typeof value === "number") {
      transformed[key] = {
        mode: "custom",
        value: value
      };
      transformationCount++;
    } else if (value === null || value === undefined) {
      transformed[key] = {
        mode: "default",
        value: null
      };
      transformationCount++;
    } else {
      // For any other case, store as-is
      transformed[key] = {
        mode: "custom",
        value: value
      };
      transformationCount++;
    }
  }

  return { transformed, transformationCount };
};

/**
 * Check if configuration needs migration
 */
const needsMigration = (configuration, service, model) => {
  if (!configuration || !service || !model) return false;

  const advancedKeys = getAdvancedParamKeys(service, model);

  for (const key of advancedKeys) {
    const value = configuration[key];
    if (value && typeof value === "object" && "mode" in value) {
      // Already in DB format
      continue;
    } else if (value !== undefined && value !== null) {
      // Needs migration
      return true;
    }
  }

  return false;
};

/**
 * Migrate configurations collection
 */
const migrateConfigurations = async (db) => {
  console.log("[MIGRATION] Starting configurations migration...");

  try {
    const configurations = db.collection("configurations");

    // Find all documents with configuration field
    const cursor = configurations.find({
      configuration: { $exists: true },
      service: { $exists: true },
      "configuration.model": { $exists: true }
    });

    let totalProcessed = 0;
    let totalMigrated = 0;
    let totalTransformed = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      totalProcessed++;

      const { _id, service, configuration } = doc;
      const model = configuration?.model;

      if (!service || !model) {
        console.log(`[MIGRATION] Skipping ${_id} - missing service or model`);
        continue;
      }

      if (!needsMigration(configuration, service, model)) {
        console.log(`[MIGRATION] Skipping ${_id} - already migrated`);
        continue;
      }

      const { transformed, transformationCount } = transformToDbFormat(configuration, service, model);

      if (transformationCount > 0) {
        await configurations.updateOne({ _id }, { $set: { configuration: transformed } });

        totalMigrated++;
        totalTransformed += transformationCount;
        console.log(`[MIGRATION] Migrated ${_id} (${service}/${model}) - ${transformationCount} params`);
      }
    }

    console.log(`[MIGRATION] Configurations migration complete:`);
    console.log(`  - Total processed: ${totalProcessed}`);
    console.log(`  - Total migrated: ${totalMigrated}`);
    console.log(`  - Total parameters transformed: ${totalTransformed}`);
  } catch (error) {
    console.error("[MIGRATION] Error in configurations migration:", error);
    throw error;
  }
};

/**
 * Migrate versions collection
 */
const migrateVersions = async (db) => {
  console.log("[MIGRATION] Starting versions migration...");

  try {
    const versions = db.collection("versions");

    // Find all documents with configuration field
    const cursor = versions.find({
      configuration: { $exists: true },
      service: { $exists: true },
      "configuration.model": { $exists: true }
    });

    let totalProcessed = 0;
    let totalMigrated = 0;
    let totalTransformed = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      totalProcessed++;

      const { _id, service, configuration } = doc;
      const model = configuration?.model;

      if (!service || !model) {
        console.log(`[MIGRATION] Skipping version ${_id} - missing service or model`);
        continue;
      }

      if (!needsMigration(configuration, service, model)) {
        console.log(`[MIGRATION] Skipping version ${_id} - already migrated`);
        continue;
      }

      const { transformed, transformationCount } = transformToDbFormat(configuration, service, model);

      if (transformationCount > 0) {
        await versions.updateOne({ _id }, { $set: { configuration: transformed } });

        totalMigrated++;
        totalTransformed += transformationCount;
        console.log(`[MIGRATION] Migrated version ${_id} (${service}/${model}) - ${transformationCount} params`);
      }
    }

    console.log(`[MIGRATION] Versions migration complete:`);
    console.log(`  - Total processed: ${totalProcessed}`);
    console.log(`  - Total migrated: ${totalMigrated}`);
    console.log(`  - Total parameters transformed: ${totalTransformed}`);
  } catch (error) {
    console.error("[MIGRATION] Error in versions migration:", error);
    throw error;
  }
};

/**
 * Main migration function
 */
const migrateToModeValueSchema = async () => {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();

    console.log("[MIGRATION] ==========================================");
    console.log("[MIGRATION] Starting mode/value schema migration...");
    console.log("[MIGRATION] ==========================================");

    await migrateConfigurations(db);
    await migrateVersions(db);

    console.log("[MIGRATION] ==========================================");
    console.log("[MIGRATION] Migration completed successfully!");
    console.log("[MIGRATION] ==========================================");
  } catch (error) {
    console.error("[MIGRATION] Migration failed:", error);
    process.exit(1);
  } finally {
    await client.close();
    console.log("MongoDB connection closed");
  }
};

// Run the migration
migrateToModeValueSchema();
