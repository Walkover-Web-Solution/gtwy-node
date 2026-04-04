import mongoose from "mongoose";
import { findInCache, scanCacheKeys, deleteInCache } from "../cache_service/index.js";
import { cost_types } from "../configs/constant.js";
import { cleanupCache } from "../services/utils/redis.utils.js";
async function moveDataRedisToMongodb(redisKeyPattern, modelName, fieldMapping = {}) {
  // Get the model from mongoose models
  const Model = mongoose.models[modelName];
  if (!Model) {
    throw new Error(`Model '${modelName}' not found`);
  }

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];
  const keysToDelete = []; // Move to local scope

  // Get all keys matching the pattern - scanCacheKeys already limits to 10,000 keys
  const keys = await scanCacheKeys(redisKeyPattern + "*");

  console.log(`Found ${keys.length} keys to process in this run`);

  // Process in batches for better MongoDB performance
  const batchSize = 50;
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    const bulkOps = [];

    for (const key of batch) {
      scanned += 1;

      try {
        // Extract ID from the key
        const keyParts = key.split(/[_:]/);
        const id = keyParts[keyParts.length - 1];

        if (!id || !mongoose.isValidObjectId(id)) {
          skipped += 1;
          continue;
        }

        const redisValue = await findInCache(key);
        if (!redisValue) {
          skipped += 1;
          continue;
        }

        let parsedValue = JSON.parse(redisValue);
        let updateData = {};

        if (parsedValue.usage_value) {
          let type =
            redisKeyPattern === "bridgeusedcost_" ? cost_types.bridge : redisKeyPattern === "folderusedcost_" ? cost_types.folder : cost_types.apikey;
          const doc = await Model.findById(id, { org_id: 1 }).lean();
          parsedValue = Number(parsedValue.usage_value);
          await cleanupCache(type, id, doc?.org_id);
        }

        for (const [dbField, config] of Object.entries(fieldMapping)) {
          switch (config.type) {
            case "date":
              updateData[dbField] = new Date(parsedValue);
              break;
            case "number":
              updateData[dbField] = Number(parsedValue);
              break;
            case "string":
              updateData[dbField] = String(parsedValue);
              break;
            case "boolean":
              updateData[dbField] = Boolean(parsedValue);
              break;
            case "object":
              updateData[dbField] = parsedValue;
              break;
            default:
              updateData[dbField] = parsedValue;
          }
        }

        // Add to bulk operations
        bulkOps.push({
          updateOne: {
            filter: { _id: new mongoose.Types.ObjectId(id) },
            update: { $set: updateData }
          }
        });

        keysToDelete.push(key);
      } catch (err) {
        errors.push({ key, message: err.message });
      }
    }

    // Execute bulk operations
    if (bulkOps.length > 0) {
      try {
        const bulkResult = await Model.bulkWrite(bulkOps, { ordered: false });
        updated += bulkResult.modifiedCount;
      } catch (bulkErr) {
        console.error("Bulk operation error:", bulkErr.message);
        errors.push({ batch: i, message: bulkErr.message });
      }
    }

    // Add delay between batches
    if (i + batchSize < keys.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // Delete successfully processed keys from Redis after all batches
  if (keysToDelete.length > 0) {
    try {
      await deleteInCache(keysToDelete);
      console.log(`Deleted ${keysToDelete.length} cache keys`);
    } catch (deleteErr) {
      console.error("Cache deletion error:", deleteErr.message);
      errors.push({ operation: "cache_deletion", message: deleteErr.message });
    }
  }

  const result = {
    success: errors.length === 0,
    scanned,
    updated,
    skipped,
    errors,
    cacheKeysDeleted: keysToDelete.length
  };

  return result;
}

export default moveDataRedisToMongodb;
