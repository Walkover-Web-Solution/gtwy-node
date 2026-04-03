const { MongoClient } = require("mongodb");
const dotenv = require("dotenv");
dotenv.config();

async function migrateAgentInfoFields() {
  const client = new MongoClient(process.env.MONGODB_CONNECTION_URI);

  try {
    console.log("Starting agent_info field migration...");

    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();

    // Process configurations collection (includes availability from page_config)
    await migrateCollection(db, "configurations", true);

    // Process bridgeversions collection (no availability)
    await migrateCollection(db, "bridgeversions", false);

    console.log("\nAgent_info field migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await client.close();
    console.log("MongoDB connection closed");
  }
}

async function migrateCollection(db, collectionName, includeAvailability) {
  console.log(`\nProcessing ${collectionName} collection...`);

  const collection = db.collection(collectionName);

  // Find ALL documents in the collection
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
      // Build the agent_info object with defaults and existing values
      const agent_info = {};

      // Add prompt_total_tokens with default if missing
      agent_info.prompt_total_tokens = doc.prompt_total_tokens || 0;

      // Add availability from page_config (only for configurations) with default
      if (includeAvailability) {
        agent_info.availability = doc.page_config?.availability || "private";
      }

      // Add connected_agent_details with default if missing
      agent_info.connected_agent_details = doc.connected_agent_details || {};

      // Add variables_state with default if missing
      agent_info.variables_state = doc.variables_state || {};

      // Create update operation
      const updateOp = {
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              agent_info: agent_info
            }
          }
        }
      };

      // Add $unset for old fields that were moved (only if they existed)
      const unsetFields = {};
      if (doc.prompt_total_tokens !== undefined) {
        unsetFields.prompt_total_tokens = 1;
      }
      if (doc.connected_agent_details !== undefined) {
        unsetFields.connected_agent_details = 1;
      }
      if (doc.variables_state !== undefined) {
        unsetFields.variables_state = 1;
      }

      // For configurations, also remove availability from page_config if it existed
      if (includeAvailability && doc.page_config?.availability !== undefined) {
        unsetFields["page_config.availability"] = 1;
      }

      if (Object.keys(unsetFields).length > 0) {
        updateOp.updateOne.update.$unset = unsetFields;
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

  // Verify migration - all documents should now have agent_info field
  const missingAgentInfoDocs = await collection.countDocuments({ agent_info: { $exists: false } });
  if (missingAgentInfoDocs === 0) {
    console.log(`Verification passed: All documents in ${collectionName} now have agent_info field`);
  } else {
    console.log(`Verification warning: ${missingAgentInfoDocs} documents in ${collectionName} still missing agent_info field`);
  }

  // Check agent_info field count
  const agentInfoDocs = await collection.countDocuments({ agent_info: { $exists: true } });
  console.log(`${collectionName} now has ${agentInfoDocs} documents with agent_info field`);
}

// Run the migration
migrateAgentInfoFields()
  .then(() => {
    console.log("Migration script completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });
