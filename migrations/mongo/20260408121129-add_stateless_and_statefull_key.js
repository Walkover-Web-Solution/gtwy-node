import { MongoClient, ObjectId } from "mongodb";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Client: PgClient } = pg;

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;

const PG_CONFIG = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS
};

/**
 * Find bridge_ids where every thread has exactly 1 conversation log.
 * These are "stateless" agents — each thread is a one-shot interaction.
 */
async function fetchStatelessBridgeIds(pgClient) {
  const query = `
    SELECT bridge_id
    FROM (
      SELECT bridge_id, thread_id, COUNT(*) AS conv_count
      FROM conversation_logs
      WHERE bridge_id IS NOT NULL
        AND bridge_id <> ''
        AND thread_id IS NOT NULL
        AND thread_id <> ''
      GROUP BY bridge_id, thread_id
    ) per_thread
    GROUP BY bridge_id
    HAVING MAX(conv_count) = 1
  `;

  const result = await pgClient.query(query);
  return result.rows.map((row) => row.bridge_id);
}

async function migrateStatelessConversation() {
  const pgClient = new PgClient(PG_CONFIG);
  const mongoClient = new MongoClient(MONGODB_URI);

  try {
    // Connect to both databases
    await pgClient.connect();
    console.log("Connected to PostgreSQL");

    await mongoClient.connect();
    console.log("Connected to MongoDB");

    const db = mongoClient.db(MONGODB_DB_NAME);
    const configurations = db.collection("configurations");
    const configurationVersions = db.collection("configuration_versions");

    // Step 1: Identify stateless bridge_ids from PostgreSQL
    console.log("\nQuerying PostgreSQL for stateless agents...");
    const bridgeIds = await fetchStatelessBridgeIds(pgClient);
    console.log(`Found ${bridgeIds.length} stateless bridge_id(s)`);

    if (bridgeIds.length === 0) {
      console.log("No stateless agents found. Nothing to migrate.");
      return;
    }

    // Convert string bridge_ids to ObjectIds for MongoDB _id matching
    const objectIds = [];
    const invalidIds = [];
    for (const id of bridgeIds) {
      try {
        objectIds.push(new ObjectId(id));
      } catch {
        invalidIds.push(id);
      }
    }

    if (invalidIds.length > 0) {
      console.warn(`\nSkipping ${invalidIds.length} bridge_id(s) that are not valid ObjectIds:`);
      invalidIds.forEach((id) => console.warn(`  - ${id}`));
    }

    if (objectIds.length === 0) {
      console.log("No valid ObjectId bridge_ids to update.");
      return;
    }

    console.log(`\nUpdating ${objectIds.length} document(s) in MongoDB...`);

    // Step 2: Update configurations collection
    const configResult = await configurations.updateMany({ _id: { $in: objectIds } }, { $set: { stateless_conversation: true } });

    console.log(`\nconfigurations:`);
    console.log(`  matched:  ${configResult.matchedCount}`);
    console.log(`  modified: ${configResult.modifiedCount}`);

    // Step 3: Update all configuration_versions whose parent bridge matches (parent_id = bridge_id)
    const versionResult = await configurationVersions.updateMany({ parent_id: { $in: bridgeIds } }, { $set: { stateless_conversation: true } });

    console.log(`\nconfiguration_versions:`);
    console.log(`  matched:  ${versionResult.matchedCount}`);
    console.log(`  modified: ${versionResult.modifiedCount}`);

    console.log("\n" + "=".repeat(60));
    console.log("Migration Summary:");
    console.log(`  Stateless bridge_ids found:              ${bridgeIds.length}`);
    console.log(`  configurations updated:                  ${configResult.modifiedCount}`);
    console.log(`  configuration_versions updated:          ${versionResult.modifiedCount}`);
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await pgClient.end();
    console.log("\nPostgreSQL connection closed");
    await mongoClient.close();
    console.log("MongoDB connection closed");
  }
}

migrateStatelessConversation()
  .then(() => {
    console.log("\n✓ Migration completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n✗ Migration failed:", error);
    process.exit(1);
  });
