/**
 * Migration: Add free_tier flag to model configurations
 *
 * free_tier marks models usable by orgs on the FREE billing plan (wallet-paid
 * runs only — customers on their own API keys are never restricted).
 *
 * Backfill is required: the admin update API (updateModelConfigs) only $sets
 * keys that already exist on a document, so without this migration the flag
 * could never be turned on through the API.
 *
 * Seeding rule:
 *   - every model gets free_tier: false
 *   - OpenRouter models whose name ends in ":free" → true
 *   - all neev_cloud models (self-hosted, near-zero marginal cost) → true
 * Adjust per model later via the admin API (free_tier is allowlisted).
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */

export const up = async (db) => {
  const collection = db.collection("modelconfigurations");

  await collection.updateMany({ free_tier: { $exists: false } }, { $set: { free_tier: false } });

  await collection.updateMany(
    { service: "open_router", model_name: { $regex: /:free$/ } },
    { $set: { free_tier: true } }
  );

  await collection.updateMany({ service: "neev_cloud" }, { $set: { free_tier: true } });
};

export const down = async (db) => {
  await db.collection("modelconfigurations").updateMany({}, { $unset: { free_tier: "" } });
};
