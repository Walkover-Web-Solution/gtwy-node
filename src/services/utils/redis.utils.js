import { findInCache, deleteInCache, invalidateByTag } from "../../cache_service/index.js";
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

/**
 * Unified cache purge for an agent/version.
 *
 * @param {Object} options
 * @param {string}       options.bridge_id    - Agent or version ID whose explicit cache keys should be deleted.
 * @param {number}       [options.bridge_usage=-1] - When 0, the usage-cost tracking key is also deleted.
 * @param {string}       options.org_id       - Organisation ID (used in cache key construction).
 * @param {string|null}  [options.version_id=null] - Version ID to match against environment_config entries.
 * @param {Object|null}  [options.agent_config=null] - The agent/bridge document (needs _id, parent_id, settings.environment_config).
 */
export async function purgeAgentCache({ bridge_id, bridge_usage = -1, org_id, version_id = null, agent_config = null }) {
  try {
    // ── 1. Explicit key deletion (bridge data keys) ──
    if (bridge_id) {
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
    }

    // ── 2. Tag-based environment invalidation ──
    if (agent_config) {
      const agent_id = agent_config.parent_id || agent_config._id;
      if (agent_id) {
        const environment_config = agent_config.settings?.environment_config || {};

        for (const [environment, deployed_version_id] of Object.entries(environment_config)) {
          if (!version_id || deployed_version_id === version_id) {
            await invalidateByTag("agent", `${agent_id}_env_${environment}`);
          }
        }
      }
    }
  } catch (e) {
    console.error(`Failed purging agent cache: ${e}`);
  }
}

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
