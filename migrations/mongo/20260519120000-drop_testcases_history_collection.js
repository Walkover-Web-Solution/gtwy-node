/**
 * Migration: drop the legacy `testcases_history` MongoDB collection.
 * Testcase run results now live on `conversation_logs` rows in Postgres
 * (columns: testcase_id, testcase_data), written via the log queue.
 *
 * Run AFTER the PG migration (add-testcase-columns-conversation-logs) is
 * deployed and the Python writer has been switched to the log queue.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const collections = await db.listCollections({ name: "testcases_history" }).toArray();
  if (collections.length > 0) {
    await db.collection("testcases_history").drop();
  }
};

/**
 * No-op: data was migrated to Postgres conversation_logs; recovering the
 * Mongo collection from the drop is not a goal.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const down = async () => {};
