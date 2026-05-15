/**
 * Migration script for ai_updates field reorganization.
 * Moves prompt_enhancer_percentage and criteria_check into ai_updates.
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const collectionsToMigrate = ["configurations", "configuration_versions"];

  for (const collectionName of collectionsToMigrate) {
    const result = await db.collection(collectionName).updateMany({ ai_updates: { $exists: false } }, [
      {
        $set: {
          ai_updates: {
            prompt_enhancer_percentage: { $ifNull: ["$prompt_enhancer_percentage", 0] },
            criteria_check: { $ifNull: ["$criteria_check", {}] }
          }
        }
      },
      {
        $unset: ["prompt_enhancer_percentage", "criteria_check"]
      }
    ]);

    console.log(`[${collectionName}] Migrated ${result.modifiedCount} document(s) to ai_updates.`);
  }
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const collectionsToMigrate = ["configurations", "configuration_versions"];

  for (const collectionName of collectionsToMigrate) {
    const result = await db.collection(collectionName).updateMany({ ai_updates: { $exists: true } }, [
      {
        $set: {
          prompt_enhancer_percentage: { $ifNull: ["$ai_updates.prompt_enhancer_percentage", 0] },
          criteria_check: { $ifNull: ["$ai_updates.criteria_check", {}] }
        }
      },
      {
        $unset: ["ai_updates"]
      }
    ]);

    console.log(`[${collectionName}] Restored ${result.modifiedCount} document(s) from ai_updates.`);
  }
};
