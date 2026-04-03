const { MongoClient } = require("mongodb");
const dotenv = require("dotenv");
dotenv.config();

async function migrateConnectedToolsFields() {
  const client = new MongoClient(process.env.MONGODB_CONNECTION_URI);

  try {
    console.log("Starting connected_tools field migration...");

    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();

    // Process configurations collection
    await migrateCollection(db, "configurations");

    // Process bridgeversions collection
    await migrateCollection(db, "bridgeversions");

    console.log("\nConnected_tools field migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await client.close();
    console.log("MongoDB connection closed");
  }
}

async function migrateCollection(db, collectionName) {
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
      // Build the connected_tools object with defaults and existing values
      const connected_tools = {};

      // Add function_ids with default if missing
      connected_tools.function_ids = doc.function_ids || [];

      // Add connected_agents with default if missing
      connected_tools.connected_agents = doc.connected_agents || {};

      // Add built_in_tools with default if missing
      connected_tools.built_in_tools = doc.built_in_tools || [];

      // Add variables_path with default if missing
      connected_tools.variables_path = doc.variables_path || {};

      // Add web_search_filters with default if missing
      connected_tools.web_search_filters = doc.web_search_filters || [];

      // Add doc_ids with default if missing
      connected_tools.doc_ids = doc.doc_ids || [];

      // Create update operation
      const updateOp = {
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              connected_tools: connected_tools
            }
          }
        }
      };

      // Add $unset for old fields that were moved (only if they existed)
      const unsetFields = {};
      if (doc.function_ids !== undefined) {
        unsetFields.function_ids = 1;
      }
      if (doc.connected_agents !== undefined) {
        unsetFields.connected_agents = 1;
      }
      if (doc.built_in_tools !== undefined) {
        unsetFields.built_in_tools = 1;
      }
      if (doc.variables_path !== undefined) {
        unsetFields.variables_path = 1;
      }
      if (doc.web_search_filters !== undefined) {
        unsetFields.web_search_filters = 1;
      }
      if (doc.doc_ids !== undefined) {
        unsetFields.doc_ids = 1;
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

  // Verify migration - all documents should now have connected_tools field
  const missingConnectedToolsDocs = await collection.countDocuments({ connected_tools: { $exists: false } });
  if (missingConnectedToolsDocs === 0) {
    console.log(`Verification passed: All documents in ${collectionName} now have connected_tools field`);
  } else {
    console.log(`Verification warning: ${missingConnectedToolsDocs} documents in ${collectionName} still missing connected_tools field`);
  }

  // Check connected_tools field count
  const connectedToolsDocs = await collection.countDocuments({ connected_tools: { $exists: true } });
  console.log(`${collectionName} now has ${connectedToolsDocs} documents with connected_tools field`);
}

// Run the migration
migrateConnectedToolsFields()
  .then(() => {
    console.log("Migration script completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });
