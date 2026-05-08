/**
 * Disables deprecated Claude models and migrates any agents/versions
 * (primary `configuration.model` or fallback `settings.fall_back.model`)
 * still pointing to them onto `claude-sonnet-4-6`.
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */

const DEPRECATED_MODELS = ["claude-3-haiku-20240307", "claude-sonnet-4-20250514", "claude-opus-4-1-20250805", "claude-opus-4-20250514"];

const REPLACEMENT_MODEL = "claude-sonnet-4-6";
const SERVICE = "anthropic";

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

  // 2) Re-point primary model on agents/versions
  const primaryFilter = { "configuration.model": { $in: DEPRECATED_MODELS } };
  const primaryUpdate = { $set: { "configuration.model": REPLACEMENT_MODEL } };

  const agentsPrimary = await configurations.updateMany(primaryFilter, primaryUpdate);
  const versionsPrimary = await versions.updateMany(primaryFilter, primaryUpdate);
  console.log(
    `[primary model] configurations updated: ${agentsPrimary.modifiedCount}, configuration_versions updated: ${versionsPrimary.modifiedCount}`
  );

  // 3) Re-point fallback model on agents/versions
  const fallbackFilter = { "settings.fall_back.model": { $in: DEPRECATED_MODELS } };
  const fallbackUpdate = { $set: { "settings.fall_back.model": REPLACEMENT_MODEL } };

  const agentsFallback = await configurations.updateMany(fallbackFilter, fallbackUpdate);
  const versionsFallback = await versions.updateMany(fallbackFilter, fallbackUpdate);
  console.log(
    `[fallback model] configurations updated: ${agentsFallback.modifiedCount}, configuration_versions updated: ${versionsFallback.modifiedCount}`
  );
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
