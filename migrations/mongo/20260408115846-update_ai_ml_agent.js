/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const filter = { service: "ai_ml" };
  const update = {
    $set: {
      service: "openai",
      "configuration.model": "gpt-5-nano"
    }
  };

  await db.collection("configurations").updateMany(filter, update);
  await db.collection("configuration_versions").updateMany(filter, update);

  // Update fall_back.service from "ai_ml" to "openai" and fall_back.model to "gpt-5-nano"
  const fallbackFilter = { "fall_back.service": "ai_ml" };
  const fallbackUpdate = {
    $set: {
      "fall_back.service": "openai",
      "fall_back.model": "gpt-5-nano"
    }
  };

  await db.collection("configurations").updateMany(fallbackFilter, fallbackUpdate);
  await db.collection("configuration_versions").updateMany(fallbackFilter, fallbackUpdate);
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const filter = { service: "openai", "configuration.model": "gpt-5-nano" };
  const update = {
    $set: {
      service: "ai_ml"
    }
  };

  await db.collection("configurations").updateMany(filter, update);
  await db.collection("configuration_versions").updateMany(filter, update);

  // Revert fall_back.service from "openai" to "ai_ml"
  const fallbackFilter = { "fall_back.service": "openai" };
  const fallbackUpdate = {
    $set: {
      "fall_back.service": "ai_ml"
    }
  };

  await db.collection("configurations").updateMany(fallbackFilter, fallbackUpdate);
  await db.collection("configuration_versions").updateMany(fallbackFilter, fallbackUpdate);
};
