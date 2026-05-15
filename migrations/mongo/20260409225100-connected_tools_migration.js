/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  console.log("Starting connected_tools field migration...");

  // Process configurations collection
  await migrateCollection(db, "configurations");

  // Process configuration_versions collection
  await migrateCollection(db, "configuration_versions");

  console.log("Connected_tools field migration completed successfully!");
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  console.log("Rolling back connected_tools field migration...");

  // Rollback configurations collection
  await rollbackCollection(db, "configurations");

  // Rollback configuration_versions collection
  await rollbackCollection(db, "configuration_versions");

  console.log("Connected_tools field rollback completed successfully!");
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
      // Build the connected_tools object with new structure
      const connected_tools = {};

      // Transform function_ids to tools array with type and args
      const functionIds = doc.function_ids || [];
      connected_tools.tools = functionIds.map((id) => ({
        id: id,
        type: "tool",
        args: {},
      }));

      // Transform connected_agents to include variable_path
      const connectedAgents = doc.connected_agents || {};
      const variablesPath = doc.variables_path || {};
      
      connected_tools.connected_agents = Object.entries(connectedAgents).map(([key, agent]) => ({
        ...agent,
        type: "agent",
        variable_path: variablesPath[key] || {},
      }));

      // Transform built_in_tools to tools array with type
      const builtInTools = doc.built_in_tools || [];
      const builtInToolsArray = builtInTools.map((tool) => ({
        id: tool,
        type: "built_in_tool",
        args: {},
      }));
      connected_tools.tools = [...connected_tools.tools, ...builtInToolsArray];

      // Add web_search_filters with default if missing
      connected_tools.web_search_filters = doc.web_search_filters || [];

      // Add gtwy_web_search_filters with default if missing
      connected_tools.gtwy_web_search_filters = doc.gtwy_web_search_filters || [];

      // Transform doc_ids to docs array
      const docIds = doc.doc_ids || [];
      connected_tools.docs = docIds.map((id) => ({
        id: id,
        type: "doc",
      }));

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
      if (doc.built_in_tools !== undefined) {
        unsetFields.built_in_tools = 1;
      }
      if (doc.variables_path !== undefined) {
        unsetFields.variables_path = 1;
      }
      if (doc.doc_ids !== undefined) {
        unsetFields.doc_ids = 1;
      }
      // Note: connected_agents is kept at top level, not moved to connected_tools

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

async function rollbackCollection(db, collectionName) {
  console.log(`\nRolling back ${collectionName} collection...`);

  const collection = db.collection(collectionName);

  // Find all documents with connected_tools field
  const documents = await collection.find({ connected_tools: { $exists: true } }).toArray();
  console.log(`Found ${documents.length} documents with connected_tools in ${collectionName}`);

  if (documents.length === 0) {
    console.log(`No documents with connected_tools found in ${collectionName}`);
    return;
  }

  // Process in batches
  const batchSize = 100;
  let processedCount = 0;

  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    const bulkOps = [];

    for (const doc of batch) {
      const connected_tools = doc.connected_tools || {};
      const setFields = {};
      const unsetFields = { connected_tools: 1 };

      // Restore function_ids from tools array
      if (connected_tools.tools && Array.isArray(connected_tools.tools)) {
        const functionIds = connected_tools.tools
          .filter((tool) => tool.type === "tool")
          .map((tool) => tool.id);
        if (functionIds.length > 0) {
          setFields.function_ids = functionIds;
        }
      }

      // Restore built_in_tools from tools array
      if (connected_tools.tools && Array.isArray(connected_tools.tools)) {
        const builtInTools = connected_tools.tools
          .filter((tool) => tool.type === "built_in_tool")
          .map((tool) => tool.id);
        if (builtInTools.length > 0) {
          setFields.built_in_tools = builtInTools;
        }
      }

      // Restore connected_agents and variables_path from connected_agents array
      if (connected_tools.connected_agents && Array.isArray(connected_tools.connected_agents)) {
        const connectedAgents = {};
        const variablesPath = {};
        
        connected_tools.connected_agents.forEach((agent) => {
          const { variable_path, type, ...agentData } = agent;
          connectedAgents[agent.id || agent.bridge_id] = agentData;
          if (variable_path && Object.keys(variable_path).length > 0) {
            variablesPath[agent.id || agent.bridge_id] = variable_path;
          }
        });
        
        if (Object.keys(connectedAgents).length > 0) {
          setFields.connected_agents = connectedAgents;
        }
        if (Object.keys(variablesPath).length > 0) {
          setFields.variables_path = variablesPath;
        }
      }

      // Restore doc_ids from docs array
      if (connected_tools.docs && Array.isArray(connected_tools.docs)) {
        const docIds = connected_tools.docs.map((doc) => doc.id);
        if (docIds.length > 0) {
          setFields.doc_ids = docIds;
        }
      }

      // Restore web_search_filters if it exists in connected_tools
      if (connected_tools.web_search_filters !== undefined) {
        setFields.web_search_filters = connected_tools.web_search_filters;
      }

      // Restore gtwy_web_search_filters if it exists in connected_tools
      if (connected_tools.gtwy_web_search_filters !== undefined) {
        setFields.gtwy_web_search_filters = connected_tools.gtwy_web_search_filters;
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
