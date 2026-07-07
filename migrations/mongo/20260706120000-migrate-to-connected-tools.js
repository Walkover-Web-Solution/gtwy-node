/**
 * Migration: Migrate legacy tool-related fields to unified connected_tools array
 * in both `configuration` (agents/bridges) and `configuration_versions` (versions) collections.
 *
 * This migration consolidates the following legacy fields into a single `connected_tools` array:
 * - function_ids → type: "tools"
 * - built_in_tools → type: "built_in_tools"
 * - connected_agents → type: "agent"
 * - doc_ids → type: "docs"
 * - pre_tools → type: "pre_tool"
 * - web_search_filters → type: "built_in_tools" with web_search_filters
 * - gtwy_web_search_filters → type: "built_in_tools" with gtwy_web_search_filters
 * - variables_path → variable_path field in tools/agent
 */

export const up = async (db) => {
  console.log("=== Starting migrate-to-connected-tools migration ===");

  const collections = [
    { name: "configurations", label: "agents (configuration)" },
    { name: "configuration_versions", label: "versions (configuration_versions)" }
  ];

  for (const { name, label } of collections) {
    console.log(`\n[${label}] Processing...`);
    const coll = db.collection(name);

    // Find documents that have any of the legacy fields
    const cursor = coll.find({
      $or: [
        { function_ids: { $exists: true, $ne: [] } },
        { built_in_tools: { $exists: true, $ne: [] } },
        { connected_agents: { $exists: true, $ne: [] } },
        { doc_ids: { $exists: true, $ne: [] } },
        { pre_tools: { $exists: true, $ne: [] } },
        { web_search_filters: { $exists: true, $ne: [] } },
        { gtwy_web_search_filters: { $exists: true, $ne: [] } },
        { variables_path: { $exists: true, $ne: {} } }
      ]
    });

    let processed = 0;
    let modified = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      const connected_tools = doc.connected_tools || [];
      let hasChanges = false;

      // Migrate function_ids to type: "tools"
      if (Array.isArray(doc.function_ids) && doc.function_ids.length > 0) {
        for (const funcId of doc.function_ids) {
          if (funcId) {
            const idStr = typeof funcId === "string" ? funcId : funcId.toString();
            // Check if already exists in connected_tools
            const exists = connected_tools.some((t) => t.type === "tools" && t.id === idStr);
            if (!exists) {
              const toolEntry = {
                type: "tools",
                id: idStr
              };
              // Add variable_path if exists for this function
              if (doc.variables_path && doc.variables_path[idStr]) {
                toolEntry.variable_path = doc.variables_path[idStr];
              }
              connected_tools.push(toolEntry);
              hasChanges = true;
            }
          }
        }
      }

      // Migrate built_in_tools to type: "built_in_tools"
      if (Array.isArray(doc.built_in_tools) && doc.built_in_tools.length > 0) {
        const builtInTools = doc.built_in_tools.map((t) => (typeof t === "string" ? t : t.toString()));
        const existingBuiltIn = connected_tools.find((t) => t.type === "built_in_tools");
        if (existingBuiltIn) {
          // Merge with existing
          const merged = [...new Set([...(existingBuiltIn.built_in_tools || []), ...builtInTools])];
          if (merged.length !== existingBuiltIn.built_in_tools?.length) {
            existingBuiltIn.built_in_tools = merged;
            hasChanges = true;
          }
        } else {
          connected_tools.push({
            type: "built_in_tools",
            built_in_tools: builtInTools
          });
          hasChanges = true;
        }
      }

      // Migrate connected_agents to type: "agent"
      if (Array.isArray(doc.connected_agents) && doc.connected_agents.length > 0) {
        for (const agent of doc.connected_agents) {
          const agentId = typeof agent === "string" ? agent : agent.id || agent._id;
          if (agentId) {
            const idStr = typeof agentId === "string" ? agentId : agentId.toString();
            const exists = connected_tools.some((t) => t.type === "agent" && t.id === idStr);
            if (!exists) {
              const agentEntry = {
                type: "agent",
                id: idStr
              };
              // Add additional fields if present
              if (typeof agent === "object") {
                if (agent.variable_path) agentEntry.variable_path = agent.variable_path;
                if (agent.thread_id !== undefined) agentEntry.thread_id = agent.thread_id;
                if (agent.version_id) agentEntry.version_id = agent.version_id;
              }
              // Add variable_path from variables_path if exists
              if (doc.variables_path && doc.variables_path[idStr]) {
                agentEntry.variable_path = doc.variables_path[idStr];
              }
              connected_tools.push(agentEntry);
              hasChanges = true;
            }
          }
        }
      }

      // Migrate doc_ids to type: "docs"
      if (Array.isArray(doc.doc_ids) && doc.doc_ids.length > 0) {
        for (const docId of doc.doc_ids) {
          if (docId) {
            const idStr = typeof docId === "string" ? docId : docId.toString();
            const exists = connected_tools.some((t) => t.type === "docs" && t.id === idStr);
            if (!exists) {
              connected_tools.push({
                type: "docs",
                id: idStr
              });
              hasChanges = true;
            }
          }
        }
      }

      // Migrate pre_tools to type: "pre_tool"
      if (Array.isArray(doc.pre_tools) && doc.pre_tools.length > 0) {
        for (const preTool of doc.pre_tools) {
          if (preTool) {
            const preToolType = preTool.type || preTool.pre_tool_type;
            const id = preTool.id || (preToolType ? Date.now().toString() + Math.random() : undefined);

            const exists = connected_tools.some((t) => t.type === "pre_tool" && t.pre_tool_type === preToolType && (id ? t.id === id : true));

            if (!exists) {
              const preToolEntry = {
                type: "pre_tool",
                pre_tool_type: preToolType
              };
              if (id) preToolEntry.id = id;
              if (preTool.config) preToolEntry.variable_path = preTool.config;
              if (preTool.prompt) preToolEntry.prompt = preTool.prompt;
              if (preTool.formats) preToolEntry.formats = preTool.formats;
              if (preTool.url) preToolEntry.url = preTool.url;
              if (preTool.args) Object.assign(preToolEntry, preTool.args);
              if (preTool.resource_id) preToolEntry.resource_id = preTool.resource_id;
              if (preTool.collection_id) preToolEntry.collection_id = preTool.collection_id;

              connected_tools.push(preToolEntry);
              hasChanges = true;
            }
          }
        }
      }

      // Migrate web_search_filters to built_in_tools web_search_filters
      if (Array.isArray(doc.web_search_filters) && doc.web_search_filters.length > 0) {
        const existingBuiltIn = connected_tools.find((t) => t.type === "built_in_tools");
        if (existingBuiltIn) {
          if (!existingBuiltIn.web_search_filters || JSON.stringify(existingBuiltIn.web_search_filters) !== JSON.stringify(doc.web_search_filters)) {
            existingBuiltIn.web_search_filters = doc.web_search_filters;
            hasChanges = true;
          }
        } else {
          connected_tools.push({
            type: "built_in_tools",
            built_in_tools: [],
            web_search_filters: doc.web_search_filters
          });
          hasChanges = true;
        }
      }

      // Migrate gtwy_web_search_filters to built_in_tools gtwy_web_search_filters
      if (Array.isArray(doc.gtwy_web_search_filters) && doc.gtwy_web_search_filters.length > 0) {
        const existingBuiltIn = connected_tools.find((t) => t.type === "built_in_tools");
        if (existingBuiltIn) {
          if (
            !existingBuiltIn.gtwy_web_search_filters ||
            JSON.stringify(existingBuiltIn.gtwy_web_search_filters) !== JSON.stringify(doc.gtwy_web_search_filters)
          ) {
            existingBuiltIn.gtwy_web_search_filters = doc.gtwy_web_search_filters;
            hasChanges = true;
          }
        } else {
          connected_tools.push({
            type: "built_in_tools",
            built_in_tools: [],
            gtwy_web_search_filters: doc.gtwy_web_search_filters
          });
          hasChanges = true;
        }
      }

      // Update document if changes were made
      if (hasChanges) {
        await coll.updateOne(
          { _id: doc._id },
          {
            $set: { connected_tools },
            $unset: {
              function_ids: "",
              built_in_tools: "",
              connected_agents: "",
              doc_ids: "",
              pre_tools: "",
              web_search_filters: "",
              gtwy_web_search_filters: "",
              variables_path: ""
            }
          }
        );
        modified += 1;
      }

      processed += 1;

      if (processed % 100 === 0) {
        console.log(`[${label}] Processed ${processed} docs so far, modified ${modified}...`);
      }
    }

    console.log(`[${label}] Done. Processed ${processed} docs, modified ${modified}.`);
  }

  console.log("\n=== Migration completed successfully ===");
};

export const down = async (db) => {
  console.log("=== Starting down migration (revert connected_tools to legacy fields) ===");

  const collections = [
    { name: "configurations", label: "agents (configuration)" },
    { name: "configuration_versions", label: "versions (configuration_versions)" }
  ];

  for (const { name, label } of collections) {
    console.log(`\n[${label}] Processing...`);
    const coll = db.collection(name);

    // Find documents that have connected_tools
    const cursor = coll.find({ connected_tools: { $exists: true, $ne: [] } });

    let processed = 0;
    let modified = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      const connected_tools = doc.connected_tools || [];

      if (connected_tools.length === 0) {
        processed += 1;
        continue;
      }

      const legacyData = {
        function_ids: [],
        built_in_tools: [],
        connected_agents: [],
        doc_ids: [],
        pre_tools: [],
        web_search_filters: [],
        gtwy_web_search_filters: [],
        variables_path: {}
      };

      for (const tool of connected_tools) {
        switch (tool.type) {
          case "tools":
            if (tool.id) {
              legacyData.function_ids.push(tool.id);
              if (tool.variable_path) {
                legacyData.variables_path[tool.id] = tool.variable_path;
              }
            }
            break;
          case "built_in_tools":
            if (tool.built_in_tools) {
              legacyData.built_in_tools = tool.built_in_tools;
            }
            if (tool.web_search_filters) {
              legacyData.web_search_filters = tool.web_search_filters;
            }
            if (tool.gtwy_web_search_filters) {
              legacyData.gtwy_web_search_filters = tool.gtwy_web_search_filters;
            }
            break;
          case "agent":
            if (tool.id) {
              const agentEntry = { id: tool.id };
              if (tool.variable_path) agentEntry.variable_path = tool.variable_path;
              if (tool.thread_id !== undefined) agentEntry.thread_id = tool.thread_id;
              if (tool.version_id) agentEntry.version_id = tool.version_id;
              legacyData.connected_agents.push(agentEntry);
              if (tool.variable_path) {
                legacyData.variables_path[tool.id] = tool.variable_path;
              }
            }
            break;
          case "docs":
            if (tool.id) {
              legacyData.doc_ids.push(tool.id);
            }
            break;
          case "pre_tool":
            if (tool.pre_tool_type) {
              const preToolEntry = {
                type: tool.pre_tool_type,
                id: tool.id
              };
              if (tool.variable_path) preToolEntry.config = tool.variable_path;
              if (tool.prompt) preToolEntry.prompt = tool.prompt;
              if (tool.formats) preToolEntry.formats = tool.formats;
              if (tool.url) preToolEntry.url = tool.url;
              if (tool.resource_id) preToolEntry.resource_id = tool.resource_id;
              if (tool.collection_id) preToolEntry.collection_id = tool.collection_id;
              legacyData.pre_tools.push(preToolEntry);
            }
            break;
        }
      }

      // Only update if we have legacy data to restore
      if (
        legacyData.function_ids.length > 0 ||
        legacyData.built_in_tools.length > 0 ||
        legacyData.connected_agents.length > 0 ||
        legacyData.doc_ids.length > 0 ||
        legacyData.pre_tools.length > 0 ||
        legacyData.web_search_filters.length > 0 ||
        legacyData.gtwy_web_search_filters.length > 0 ||
        Object.keys(legacyData.variables_path).length > 0
      ) {
        const updateSet = {};
        if (legacyData.function_ids.length > 0) updateSet.function_ids = legacyData.function_ids;
        if (legacyData.built_in_tools.length > 0) updateSet.built_in_tools = legacyData.built_in_tools;
        if (legacyData.connected_agents.length > 0) updateSet.connected_agents = legacyData.connected_agents;
        if (legacyData.doc_ids.length > 0) updateSet.doc_ids = legacyData.doc_ids;
        if (legacyData.pre_tools.length > 0) updateSet.pre_tools = legacyData.pre_tools;
        if (legacyData.web_search_filters.length > 0) updateSet.web_search_filters = legacyData.web_search_filters;
        if (legacyData.gtwy_web_search_filters.length > 0) updateSet.gtwy_web_search_filters = legacyData.gtwy_web_search_filters;
        if (Object.keys(legacyData.variables_path).length > 0) updateSet.variables_path = legacyData.variables_path;

        await coll.updateOne(
          { _id: doc._id },
          {
            $set: updateSet,
            $unset: { connected_tools: "" }
          }
        );
        modified += 1;
      }

      processed += 1;

      if (processed % 100 === 0) {
        console.log(`[${label}] Processed ${processed} docs so far, modified ${modified}...`);
      }
    }

    console.log(`[${label}] Done. Processed ${processed} docs, modified ${modified}.`);
  }

  console.log("\n=== Down migration completed ===");
};
