/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  console.log("Starting agent_info field migration...");

  // Process configurations collection
  await migrateCollection(db, "configurations");

  // Process configuration_versions collection
  await migrateCollection(db, "configuration_versions");

  console.log("Agent_info field migration completed successfully!");
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  console.log("Rolling back agent_info field migration...");

  // Rollback configurations collection
  await rollbackCollection(db, "configurations");

  // Rollback configuration_versions collection
  await rollbackCollection(db, "configuration_versions");

  console.log("Agent_info field rollback completed successfully!");
};

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
      // Build the agent_info object with schema defaults and existing values
      const agent_info = {
        prompt_total_tokens: doc.prompt_total_tokens || 0,
        agent_variables: {},
        description: "",
        thread_id: false,
        variables_state: doc.variables_state || {}
      };

      // Spread connected_agent_details properties directly into agent_info
      // This flattens the structure so agent_variables and description are at top level
      const connected_agent_details = doc.connected_agent_details || {};
      if (connected_agent_details && typeof connected_agent_details === "object") {
        Object.assign(agent_info, connected_agent_details);
      }

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

async function rollbackCollection(db, collectionName) {
  console.log(`\nRolling back ${collectionName} collection...`);

  const collection = db.collection(collectionName);

  // Find all documents with agent_info field
  const documents = await collection.find({ agent_info: { $exists: true } }).toArray();
  console.log(`Found ${documents.length} documents with agent_info in ${collectionName}`);

  if (documents.length === 0) {
    console.log(`No documents with agent_info found in ${collectionName}`);
    return;
  }

  // Process in batches
  const batchSize = 100;
  let processedCount = 0;

  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    const bulkOps = [];

    for (const doc of batch) {
      const agent_info = doc.agent_info || {};
      const setFields = {};
      const unsetFields = { agent_info: 1 };

      // Restore prompt_total_tokens if it exists in agent_info
      if (agent_info.prompt_total_tokens !== undefined) {
        setFields.prompt_total_tokens = agent_info.prompt_total_tokens;
      }

      // Restore connected_agent_details by collecting all properties except known top-level ones
      // Properties like agent_variables and description should go back into connected_agent_details
      const connected_agent_details = {};
      const knownTopLevelFields = ["prompt_total_tokens", "variables_state"];

      for (const [key, value] of Object.entries(agent_info)) {
        if (!knownTopLevelFields.includes(key)) {
          connected_agent_details[key] = value;
        }
      }

      if (Object.keys(connected_agent_details).length > 0) {
        setFields.connected_agent_details = connected_agent_details;
      }

      // Restore variables_state if it exists in agent_info
      if (agent_info.variables_state !== undefined) {
        setFields.variables_state = agent_info.variables_state;
      }

      const updateOp = {
        updateOne: {
          filter: { _id: doc._id },
          update: {}
        }
      };

      if (Object.keys(setFields).length > 0) {
        updateOp.updateOne.update.$set = setFields;
      }

      updateOp.updateOne.update.$unset = unsetFields;

      bulkOps.push(updateOp);
    }

    // Execute batch update
    if (bulkOps.length > 0) {
      const result = await collection.bulkWrite(bulkOps);
      processedCount += result.modifiedCount;
      console.log(
        `Rolled back batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(documents.length / batchSize)}: ${result.modifiedCount} documents updated`
      );
    }
  }

  console.log(`Completed rollback for ${collectionName}: ${processedCount} documents updated`);
}
