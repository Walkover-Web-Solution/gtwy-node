const { MongoClient } = require("mongodb");
const dotenv = require("dotenv");
dotenv.config();

/**
 * Migration script for agent_limit field reorganization
 *
 * This script moves the following fields from root level into a nested agent_limit object:
 * - bridge_limit → agent_limit.limit
 * - bridge_usage → agent_limit.usage
 * - bridge_limit_reset_period → agent_limit.reset_period
 * - bridge_limit_start_date → agent_limit.start_date
 *
 */

async function migrateAgentLimitFields() {
  const client = new MongoClient(process.env.MONGODB_CONNECTION_URI);

  try {
    console.log("Starting agent_limit field migration...");

    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();
    const collectionName = "configurations";

    console.log(`\nProcessing ${collectionName} collection...`);

    const collection = db.collection(collectionName);

    // Find ALL documents in the collection to ensure everyone gets agent_limit field
    const documents = await collection.find({}).toArray();
    console.log(`Found ${documents.length} total documents in ${collectionName}`);

    if (documents.length === 0) {
      console.log(`No documents found in ${collectionName}`);
      return;
    }

    // Process in batches
    const batchSize = 100;
    let processedCount = 0;

    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      const bulkOps = [];

      for (const doc of batch) {
        // Check if document already has agent_limit field
        if (doc.agent_limit) {
          console.log(`Document ${doc._id} already has agent_limit field, skipping...`);
          continue;
        }

        // Build the agent_limit object with new field names
        // Use existing bridge_* values if they exist, otherwise use defaults
        const agent_limit = {
          limit: doc.bridge_limit || 0,
          usage: doc.bridge_usage || 0,
          reset_period: doc.bridge_limit_reset_period || "monthly",
          start_date: doc.bridge_limit_start_date || new Date()
        };

        // Create update operation
        const updateOp = {
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: {
                agent_limit: agent_limit
              }
            }
          }
        };

        // Only unset old fields if they exist
        if (
          doc.bridge_limit !== undefined ||
          doc.bridge_usage !== undefined ||
          doc.bridge_limit_reset_period !== undefined ||
          doc.bridge_limit_start_date !== undefined
        ) {
          updateOp.updateOne.update.$unset = {
            bridge_limit: 1,
            bridge_usage: 1,
            bridge_limit_reset_period: 1,
            bridge_limit_start_date: 1
          };
        }

        bulkOps.push(updateOp);
      }

      // Execute batch update
      if (bulkOps.length > 0) {
        const result = await collection.bulkWrite(bulkOps);
        processedCount += result.modifiedCount;
        console.log(
          `Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(documents.length / batchSize)}: ${result.modifiedCount} documents updated`
        );
      }
    }

    console.log(`Completed ${collectionName}: ${processedCount} documents updated`);

    // Verify migration - check for documents missing agent_limit field
    const missingAgentLimitDocs = await collection.countDocuments({ agent_limit: { $exists: false } });
    if (missingAgentLimitDocs === 0) {
      console.log(`Verification passed: All documents now have agent_limit field`);
    } else {
      console.log(` Verification warning: ${missingAgentLimitDocs} documents still missing agent_limit field`);
    }

    // Check if any old bridge_* fields remain
    const verifyQuery = {
      $or: [
        { bridge_limit: { $exists: true } },
        { bridge_usage: { $exists: true } },
        { bridge_limit_reset_period: { $exists: true } },
        { bridge_limit_start_date: { $exists: true } }
      ]
    };

    const remainingDocs = await collection.countDocuments(verifyQuery);
    if (remainingDocs === 0) {
      console.log(`Verification passed: All old bridge_* fields removed`);
    } else {
      console.log(`  Verification warning: ${remainingDocs} documents still have old bridge_* fields`);
    }

    // Check agent_limit fields
    const agentLimitDocs = await collection.countDocuments({ agent_limit: { $exists: true } });
    console.log(` ${collectionName} now has ${agentLimitDocs} documents with agent_limit field`);

    console.log("\nAgent_limit field migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await client.close();
    console.log("MongoDB connection closed");
  }
}

// Run the migration
migrateAgentLimitFields()
  .then(() => {
    console.log("Migration script completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });
