"use strict";
const { MongoClient } = require("mongodb");

const BATCH_SIZE = 500;

/**
 * Backfill conversation_logs.display_name from the MongoDB `threads` collection.
 *
 * - Skips docs where display_name is missing or equals sub_thread_id (the default):
 *   reads use COALESCE(display_name, sub_thread_id), so defaults are stored as NULL.
 * - Idempotent and re-runnable: it only sets the column where the value differs.
 *
 * Requires env vars: MONGODB_CONNECTION_URI, MONGODB_DATABASE_NAME
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const mongoUrl = process.env.MONGODB_CONNECTION_URI;
    if (!mongoUrl) {
      throw new Error("MONGODB_CONNECTION_URI env var is required for this migration");
    }
    const mongoClient = new MongoClient(mongoUrl);

    let processed = 0;
    let updatedRows = 0;
    let skippedDefault = 0;
    let errorCount = 0;

    try {
      console.log("Starting migration: backfill conversation_logs.display_name from Mongo threads...");
      await mongoClient.connect();
      console.log("Connected to MongoDB successfully");

      const db = mongoClient.db(process.env.MONGODB_DATABASE_NAME);
      const threadsCollection = db.collection("threads");

      const cursor = threadsCollection
        .find({}, { projection: { org_id: 1, bridge_id: 1, thread_id: 1, sub_thread_id: 1, display_name: 1 } })
        .batchSize(BATCH_SIZE);

      for await (const thread of cursor) {
        processed++;
        try {
          const { org_id, bridge_id, thread_id, sub_thread_id, display_name } = thread;

          if (!org_id || !thread_id || !sub_thread_id) {
            skippedDefault++;
            continue;
          }

          // Default names are represented as NULL in PG — nothing to copy.
          if (!display_name || display_name === sub_thread_id) {
            skippedDefault++;
            continue;
          }

          const replacements = { name: display_name, org_id, thread_id, sub_thread_id };
          let bridgeClause = "";
          if (bridge_id) {
            bridgeClause = ` AND bridge_id = :bridge_id`;
            replacements.bridge_id = bridge_id;
          }

          const [, meta] = await queryInterface.sequelize.query(
            `UPDATE conversation_logs
             SET display_name = :name
             WHERE org_id = :org_id
               AND thread_id = :thread_id
               AND sub_thread_id = :sub_thread_id${bridgeClause}
               AND (display_name IS DISTINCT FROM :name)`,
            { replacements }
          );
          updatedRows += meta?.rowCount ?? 0;
        } catch (err) {
          errorCount++;
          console.error(`Error backfilling thread ${thread?._id}: ${err.message}`);
        }

        if (processed % 5000 === 0) {
          console.log(
            `Progress: ${processed} docs processed, ${updatedRows} rows updated, ${skippedDefault} skipped (default), ${errorCount} errors`
          );
        }
      }

      console.log(
        `Backfill completed: ${processed} Mongo docs processed, ${updatedRows} conversation_logs rows updated, ${skippedDefault} skipped (default/incomplete), ${errorCount} errors`
      );
    } finally {
      await mongoClient.close();
    }
  },

  async down() {
    // Data backfill — intentionally not reversible. Dropping the column
    // (previous migration's down) removes the data anyway.
  }
};
