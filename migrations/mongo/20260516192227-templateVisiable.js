/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const result = await db.collection("templates").updateMany({}, { $set: { visible: false } });

  console.log(`Updated ${result.modifiedCount} templates - set visible to false`);
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async () => {
  console.log("Rollback skipped: previous template visible values cannot be restored.");
};
