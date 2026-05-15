/**
 * Disables deprecated Claude models and migrates any agents/versions
 * (primary `configuration.model` or fallback `settings.fall_back.model`)
 * still pointing to them onto `claude-sonnet-4-6`. Also purges Redis
 * caches for every affected agent and version.
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
import { deleteInCache } from "../../src/cache_service/index.js";
import { redis_keys } from "../../src/configs/constant.js";

const DEPRECATED_MODELS = ["claude-3-haiku-20240307", "claude-sonnet-4-20250514", "claude-opus-4-1-20250805", "claude-opus-4-20250514"];

const REPLACEMENT_MODEL = "claude-sonnet-4-6";
const SERVICE = "anthropic";

const buildCacheKeysForDoc = (doc) => {
  const keys = [];
  if (!doc || !doc.org_id || !doc._id) return keys;
  const ids = new Set();
  ids.add(doc._id.toString());
  if (doc.parent_id) ids.add(doc.parent_id.toString());
  for (const id of ids) {
    keys.push(`${redis_keys.get_bridge_data_}${doc.org_id}_${id}`);
    keys.push(`${redis_keys.bridge_data_with_tools_}${doc.org_id}_${id}`);
  }
  return keys;
};

export const up = async (db) => {
  const modelConfigs = db.collection("modelconfigurations");
  const configurations = db.collection("configurations");
  const versions = db.collection("configuration_versions");

  // 1) Disable the deprecated model configs (status=0 + disabled_at=now)
  const disableRes = await modelConfigs.updateMany(
    { service: SERVICE, model_name: { $in: DEPRECATED_MODELS } },
    { $set: { status: 0, disabled_at: new Date() } }
  );
  console.log(`[modelconfigurations] Disabled ${disableRes.modifiedCount} model config(s).`);

  // 2) Collect every agent/version that references a deprecated model
  //    (primary or fallback) BEFORE updating, so we can purge their caches.
  const matchFilter = {
    $or: [{ "configuration.model": { $in: DEPRECATED_MODELS } }, { "settings.fall_back.model": { $in: DEPRECATED_MODELS } }]
  };
  const projection = { _id: 1, org_id: 1, parent_id: 1 };

  const affectedAgents = await configurations.find(matchFilter).project(projection).toArray();
  const affectedVersions = await versions.find(matchFilter).project(projection).toArray();
  console.log(`[scan] Affected agents: ${affectedAgents.length}, versions: ${affectedVersions.length}`);

  // 3) Re-point primary model on agents/versions
  const primaryFilter = { "configuration.model": { $in: DEPRECATED_MODELS } };
  const primaryUpdate = { $set: { "configuration.model": REPLACEMENT_MODEL } };

  const agentsPrimary = await configurations.updateMany(primaryFilter, primaryUpdate);
  const versionsPrimary = await versions.updateMany(primaryFilter, primaryUpdate);
  console.log(
    `[primary model] configurations updated: ${agentsPrimary.modifiedCount}, configuration_versions updated: ${versionsPrimary.modifiedCount}`
  );

  // 4) Re-point fallback model on agents/versions
  const fallbackFilter = { "settings.fall_back.model": { $in: DEPRECATED_MODELS } };
  const fallbackUpdate = { $set: { "settings.fall_back.model": REPLACEMENT_MODEL } };

  const agentsFallback = await configurations.updateMany(fallbackFilter, fallbackUpdate);
  const versionsFallback = await versions.updateMany(fallbackFilter, fallbackUpdate);
  console.log(
    `[fallback model] configurations updated: ${agentsFallback.modifiedCount}, configuration_versions updated: ${versionsFallback.modifiedCount}`
  );

  // 5) Purge Redis caches for every affected agent and version
  try {
    const cacheKeys = new Set();
    [...affectedAgents, ...affectedVersions].forEach((doc) => {
      buildCacheKeysForDoc(doc).forEach((k) => cacheKeys.add(k));
    });

    if (cacheKeys.size > 0) {
      // Chunk to avoid oversized DEL commands
      const allKeys = Array.from(cacheKeys);
      const batchSize = 500;
      for (let i = 0; i < allKeys.length; i += batchSize) {
        await deleteInCache(allKeys.slice(i, i + batchSize));
      }
      console.log(`[cache] Purged ${cacheKeys.size} Redis key(s) for affected agents/versions.`);
    } else {
      console.log("[cache] No cache keys to purge.");
    }
  } catch (e) {
    console.error(`[cache] Failed to purge caches: ${e}`);
  }
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  // Best-effort rollback: re-enable the deprecated model configs.
  // We cannot recover which agents/versions previously used which deprecated model,
  // so the agent/version model reassignments are intentionally NOT reverted.
  const modelConfigs = db.collection("modelconfigurations");

  const res = await modelConfigs.updateMany({ service: SERVICE, model_name: { $in: DEPRECATED_MODELS } }, { $set: { status: 1, disabled_at: null } });
  console.log(`[modelconfigurations] Re-enabled ${res.modifiedCount} model config(s).`);
  console.log("Note: agent/version model reassignments to claude-sonnet-4-6 are not reverted.");
};
