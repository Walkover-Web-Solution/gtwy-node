/**
 * Groq shut down `llama-3.3-70b-versatile` on 08/16/26 and points callers at
 * `openai/gpt-oss-120b` as its replacement (see Groq's deprecation guide).
 * That model was seeded as Groq's `default_model` / `default_fallback_model` in
 * `20260606120000-seed_services_registry.js` and `20260723120000-add_service_keys.js`,
 * so every "add apikey" validation call for Groq (POST /chat/completions with the
 * service default model) now fails against a model that no longer exists.
 *
 * This migration:
 *   1) repoints the Groq registry entry (`default_model`, `default_fallback_model`)
 *      at `openai/gpt-oss-120b`, which fixes apikey validation;
 *   2) disables the dead `llama-3.3-70b-versatile` model config so it stops being
 *      offered, and moves any agent/version still on it (primary or fallback) onto
 *      the replacement;
 *   3) purges the Redis caches of every affected agent/version.
 *
 * Mirrors 20260508104500-disable-deprecated-claude-models.js.
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
import { deleteInCache } from "../../src/cache_service/index.js";
import { redis_keys } from "../../src/configs/constant.js";

const SERVICE = "groq";
const DEPRECATED_MODEL = "llama-3.3-70b-versatile";
const REPLACEMENT_MODEL = "openai/gpt-oss-120b";

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

const purgeCaches = async (docs) => {
  try {
    const cacheKeys = new Set();
    docs.forEach((doc) => {
      buildCacheKeysForDoc(doc).forEach((k) => cacheKeys.add(k));
    });

    if (cacheKeys.size === 0) {
      console.log("[cache] No cache keys to purge.");
      return;
    }

    // Chunk to avoid oversized DEL commands
    const allKeys = Array.from(cacheKeys);
    const batchSize = 500;
    for (let i = 0; i < allKeys.length; i += batchSize) {
      await deleteInCache(allKeys.slice(i, i + batchSize));
    }
    console.log(`[cache] Purged ${cacheKeys.size} Redis key(s) for affected agents/versions.`);
  } catch (e) {
    console.error(`[cache] Failed to purge caches: ${e}`);
  }
};

/**
 * Moves every agent/version off `from` and onto `to` (primary + fallback model),
 * then purges their caches.
 */
const repointAgentsAndVersions = async (db, from, to) => {
  const configurations = db.collection("configurations");
  const versions = db.collection("configuration_versions");

  // Collect affected docs BEFORE updating so we can purge their caches after.
  const matchFilter = { $or: [{ "configuration.model": from }, { "settings.fall_back.model": from }] };
  const projection = { _id: 1, org_id: 1, parent_id: 1 };

  const affectedAgents = await configurations.find(matchFilter).project(projection).toArray();
  const affectedVersions = await versions.find(matchFilter).project(projection).toArray();
  console.log(`[scan] Affected agents: ${affectedAgents.length}, versions: ${affectedVersions.length}`);

  const primaryFilter = { "configuration.model": from };
  const primaryUpdate = { $set: { "configuration.model": to } };
  const agentsPrimary = await configurations.updateMany(primaryFilter, primaryUpdate);
  const versionsPrimary = await versions.updateMany(primaryFilter, primaryUpdate);
  console.log(
    `[primary model] configurations updated: ${agentsPrimary.modifiedCount}, configuration_versions updated: ${versionsPrimary.modifiedCount}`
  );

  const fallbackFilter = { "settings.fall_back.model": from };
  const fallbackUpdate = { $set: { "settings.fall_back.model": to } };
  const agentsFallback = await configurations.updateMany(fallbackFilter, fallbackUpdate);
  const versionsFallback = await versions.updateMany(fallbackFilter, fallbackUpdate);
  console.log(
    `[fallback model] configurations updated: ${agentsFallback.modifiedCount}, configuration_versions updated: ${versionsFallback.modifiedCount}`
  );

  await purgeCaches([...affectedAgents, ...affectedVersions]);
};

export const up = async (db) => {
  // The replacement is expected to already be registered for Groq; warn (don't
  // abort) if it isn't, since apikey validation only needs the model id upstream.
  const replacementConfig = await db.collection("modelconfigurations").findOne({ service: SERVICE, model_name: REPLACEMENT_MODEL, status: 1 });
  if (!replacementConfig) {
    console.warn(`[modelconfigurations] No enabled ${SERVICE} config found for ${REPLACEMENT_MODEL}; register it so agents can select it.`);
  }

  // 1) Repoint the Groq service registry so apikey validation and new agents
  //    use a model Groq still serves.
  const services = await db
    .collection("services")
    .updateOne({ service_name: SERVICE }, { $set: { default_model: REPLACEMENT_MODEL, default_fallback_model: REPLACEMENT_MODEL } });
  console.log(
    `[services] Groq default/fallback model set to ${REPLACEMENT_MODEL} (matched ${services.matchedCount}, modified ${services.modifiedCount}).`
  );

  // 2) Disable the shut-down model config (status=0 + disabled_at=now).
  const disableRes = await db
    .collection("modelconfigurations")
    .updateMany({ service: SERVICE, model_name: DEPRECATED_MODEL }, { $set: { status: 0, disabled_at: new Date() } });
  console.log(`[modelconfigurations] Disabled ${disableRes.modifiedCount} model config(s) for ${DEPRECATED_MODEL}.`);

  // 3) Move any agent/version still on the dead model onto the replacement.
  await repointAgentsAndVersions(db, DEPRECATED_MODEL, REPLACEMENT_MODEL);
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  // Restore the previously seeded Groq defaults and re-enable the model config.
  // Agent/version reassignments are intentionally NOT reverted: we cannot tell
  // which agents were already on the replacement before this migration ran.
  const services = await db
    .collection("services")
    .updateOne({ service_name: SERVICE }, { $set: { default_model: DEPRECATED_MODEL, default_fallback_model: DEPRECATED_MODEL } });
  console.log(`[services] Groq default/fallback model restored to ${DEPRECATED_MODEL} (modified ${services.modifiedCount}).`);

  const res = await db
    .collection("modelconfigurations")
    .updateMany({ service: SERVICE, model_name: DEPRECATED_MODEL }, { $set: { status: 1, disabled_at: null } });
  console.log(`[modelconfigurations] Re-enabled ${res.modifiedCount} model config(s).`);
  console.log(`Note: agent/version reassignments to ${REPLACEMENT_MODEL} are not reverted.`);
};
