import { findInCache, deleteInCache } from "../../cache_service/index.js";
import { redis_keys } from "../../configs/constant.js";

const createRedisKeys = (data, org_id) => {
  const keys_to_delete = [];
  try {
    if (typeof data !== "object" || data === null) {
      return keys_to_delete;
    }

    const versions = data.versions || [];

    for (const version of versions) {
      keys_to_delete.push(`${redis_keys.bridge_data_with_tools_}${org_id}_${version}`);
      keys_to_delete.push(`${redis_keys.get_bridge_data_}${org_id}_${version}`);
    }
  } catch (e) {
    console.error(`Error creating redis keys from usage data: ${e}`);
  }

  return keys_to_delete;
};

export const purgeRelatedBridgeCaches = async (bridge_id, bridge_usage = -1, org_id) => {
  try {
    if (!bridge_id) {
      return;
    }

    const usage_cache_key = `${redis_keys.bridgeusedcost_}${bridge_id}`;
    const keys_to_delete = [];

    const usage_cache_value = await findInCache(usage_cache_key);
    if (usage_cache_value) {
      try {
        const usage_data = JSON.parse(usage_cache_value) || {};
        keys_to_delete.push(...createRedisKeys(usage_data, org_id));
      } catch {
        // ignore
      }
    }

    // Ensure current bridge's own keys are covered
    keys_to_delete.push(`${redis_keys.bridge_data_with_tools_}${org_id}_${bridge_id}`);
    keys_to_delete.push(`${redis_keys.get_bridge_data_}${org_id}_${bridge_id}`);

    if (keys_to_delete.length > 0) {
      await deleteInCache(keys_to_delete);
    }
    if (bridge_usage === 0) {
      await deleteInCache(usage_cache_key);
    }
  } catch (e) {
    console.error(`Failed purging related bridge caches: ${e}`);
  }
};

export async function cleanupCache(type, id, org_id) {
  try {
    const cacheKey = `${redis_keys[type + "usedcost_"]}${id}`;
    const cacheobject = await findInCache(cacheKey);
    const cachevalues = JSON.parse(cacheobject);
    let allcachekeys = [];
    if (cachevalues) {
      const versions = cachevalues.versions;
      const bridges = cachevalues.bridges;

      if (versions && versions.length > 0) {
        versions.forEach((version) => {
          allcachekeys.push(`${redis_keys.bridge_data_with_tools_}${org_id}_${version}`);
          allcachekeys.push(`${redis_keys.get_bridge_data_}${org_id}_${version}`);
        });
      }
      if (bridges && bridges.length > 0) {
        bridges.forEach((bridge) => {
          allcachekeys.push(`${redis_keys.bridge_data_with_tools_}${org_id}_${bridge}`);
          allcachekeys.push(`${redis_keys.get_bridge_data_}${org_id}_${bridge}`);
        });
      }
    }

    if (allcachekeys.length > 0) {
      await deleteInCache(allcachekeys);
      console.log(`Deleted ${allcachekeys.length} cache keys for ${type}: ${id}`);
    }

    return true;
  } catch (error) {
    console.error("Error deleting cache:", error);
    return false;
  }
}

export default {
  deleteInCache
};
