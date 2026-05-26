/**
 * Migration: change auto_model_select from `true` to `{ tradeoff: "cost" }`
 * Only documents where auto_model_select === true are updated.
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  // Step 1: any auto_model_select that is not `true` (missing or other value) -> null
  const nullFilter = { auto_model_select: { $ne: true } };
  const nullUpdate = { $set: { auto_model_select: null } };

  await db.collection("configurations").updateMany(nullFilter, nullUpdate);
  await db.collection("configuration_versions").updateMany(nullFilter, nullUpdate);

  // Step 2: auto_model_select === true -> { tradeoff: "cost" }
  const filter = { auto_model_select: true };
  const update = {
    $set: {
      auto_model_select: { tradeoff: "cost" }
    }
  };

  await db.collection("configurations").updateMany(filter, update);
  await db.collection("configuration_versions").updateMany(filter, update);
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const filter = { "auto_model_select.tradeoff": "cost" };
  const update = {
    $set: {
      auto_model_select: true
    }
  };

  await db.collection("configurations").updateMany(filter, update);
  await db.collection("configuration_versions").updateMany(filter, update);
};
