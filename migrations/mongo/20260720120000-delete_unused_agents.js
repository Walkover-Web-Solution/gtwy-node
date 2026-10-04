import jwt from "jsonwebtoken";
import axios from "axios";

/**
 * Migration: Delete unused agents and their associated data
 *
 * This migration deletes:
 * 1. Agents (configurations) that haven't been used in 30 days
 *    - If last_used exists and is older than 30 days
 *    - If last_used is null and created_at is older than 30 days
 *    - ONLY if the agent is NOT connected to any active agents (via connected_agents field)
 * 2. All versions (configuration_versions) of deleted agents
 * 3. Tools (apicalls) for orgs that have no remaining agents
 * 4. Knowledge bases (rag_collections) for orgs that have no remaining agents
 * 5. Disables tools in Viasocket embed system (status=0) before deleting from database
 * 6. Deletes organizations from MSG91 routes when they have no remaining agents
 *
 * Safety checks:
 * - Skips agents that are referenced in ACTIVE agent's connected_agents field
 * - ACTIVE means: the parent agent is NOT also unused (doesn't meet deletion criteria)
 * - If both parent and child agents are unused, both will be deleted
 * - Skips agents that are referenced in any version's connected_agents where parent is active
 * - Only deletes tools and knowledge bases when ALL agents of an org are deleted
 * - Only deletes orgs from MSG91 when ALL agents of an org are deleted
 * - Does not delete already soft-deleted agents
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  console.log("=== Starting delete_unused_agents migration ===");

  const configurationsCollection = db.collection("configurations");
  const versionsCollection = db.collection("configuration_versions");
  const apicallsCollection = db.collection("apicalls");
  const ragCollectionsCollection = db.collection("rag_collections");

  // Check for required environment variables
  const ORG_ID = process.env.ORG_ID;
  const PROJECT_ID = process.env.PROJECT_ID;
  const ACCESS_KEY = process.env.ACCESS_KEY;
  const PROXY_USER_REFERENCE_ID = process.env.PROXY_USER_REFERENCE_ID;
  const PROXY_ADMIN_TOKEN = process.env.PROXY_ADMIN_TOKEN;

  if (!ORG_ID || !PROJECT_ID || !ACCESS_KEY) {
    console.error("ERROR: Required environment variables not set (ORG_ID, PROJECT_ID, ACCESS_KEY)");
    throw new Error("Missing required environment variables for embed token generation");
  }

  if (!PROXY_USER_REFERENCE_ID || !PROXY_ADMIN_TOKEN) {
    console.error("ERROR: Required environment variables not set (PROXY_USER_REFERENCE_ID, PROXY_ADMIN_TOKEN)");
    throw new Error("Missing required environment variables for MSG91 organization deletion");
  }

  const HIPPOCAMPUS_BASE_URL = process.env.HIPPOCAMPUS_BASE_URL || "http://hippocampus.gtwy.ai";
  const HIPPOCAMPUS_API_KEY = process.env.HIPPOCAMPUS_API_KEY;

  /**
   * Soft delete a resource in Hippocampus
   */
  const deleteResourceInHippocampus = async (resourceId) => {
    if (!HIPPOCAMPUS_API_KEY) {
      console.warn(`    - HIPPOCAMPUS_API_KEY not set; skipping resource ${resourceId} deletion`);
      return { success: false, error: "HIPPOCAMPUS_API_KEY not set" };
    }
    try {
      await axios.delete(`${HIPPOCAMPUS_BASE_URL}/resource/${resourceId}`, {
        headers: {
          "x-api-key": HIPPOCAMPUS_API_KEY,
          "Content-Type": "application/json"
        }
      });
      return { success: true };
    } catch (error) {
      console.error(`    - Failed to soft-delete resource ${resourceId} in Hippocampus:`, error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  };

  /**
   * Generate embed token for Viasocket API calls
   */
  const generateEmbedToken = (org_id) => {
    const viasocket_embed_user_id = String(org_id);
    const payload = {
      org_id: ORG_ID,
      project_id: PROJECT_ID,
      user_id: viasocket_embed_user_id
    };
    return jwt.sign(payload, ACCESS_KEY);
  };

  /**
   * Disable tool in Viasocket embed system
   */
  const disableToolInEmbed = async (scriptId, embedToken) => {
    try {
      const url = `https://flow-api.viasocket.com/embed/updatestatus/${scriptId}?status=0`;
      const response = await axios.put(
        url,
        {},
        {
          headers: {
            authorization: embedToken
          }
        }
      );
      return { success: true, data: response.data };
    } catch (error) {
      console.error(`  Warning: Failed to disable tool ${scriptId} in embed:`, error.message);
      return { success: false, error: error.message };
    }
  };

  /**
   * Delete organization from MSG91 routes
   */
  const deleteOrgFromMSG91 = async (orgId) => {
    try {
      const url = `https://routes.msg91.com/api/${PROXY_USER_REFERENCE_ID}/deleteCCompany/${orgId}`;
      const response = await axios.delete(url, {
        headers: {
          authkey: PROXY_ADMIN_TOKEN
        }
      });
      return { success: true, data: response.data };
    } catch (error) {
      // 404 means org doesn't exist in MSG91, which is fine
      if (error.response?.status === 404) {
        console.log(`    - Org ${orgId} not found in MSG91 (may have been deleted already)`);
        return { success: true, notFound: true };
      }
      console.error(`  Warning: Failed to delete org ${orgId} from MSG91:`, error.message);
      return { success: false, error: error.message };
    }
  };

  // Calculate the date 30 days ago
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  console.log(`\nCutoff date: ${thirtyDaysAgo.toISOString()}`);

  // Step 1: Find agents to delete
  console.log("\n[Step 1] Finding unused agents...");

  const unusedAgentsQuery = {
    $or: [
      // Case 1: last_used exists and is older than 30 days
      {
        last_used: { $ne: null, $lt: thirtyDaysAgo }
      },
      // Case 2: last_used is null and created_at is older than 30 days
      {
        $and: [{ $or: [{ last_used: null }, { last_used: { $exists: false } }] }, { created_at: { $lt: thirtyDaysAgo } }]
      }
    ],
    // Don't delete already soft-deleted agents
    deletedAt: null
  };

  const unusedAgents = await configurationsCollection.find(unusedAgentsQuery).toArray();
  console.log(`Found ${unusedAgents.length} potentially unused agents`);

  if (unusedAgents.length === 0) {
    console.log("\n=== Migration completed: No unused agents found ===");
    return;
  }

  // Step 1.5: Filter out agents that are connected to other ACTIVE agents
  // (agents that don't meet the deletion criteria and are still being used)
  console.log("\n[Step 1.5] Filtering out agents connected to active agents...");

  const agentsToDelete = [];
  const skippedAgents = [];
  const unusedAgentIds = new Set(unusedAgents.map((a) => a._id.toString()));

  for (const agent of unusedAgents) {
    const agentId = agent._id.toString();

    // Check if this agent is referenced in any active agent's connected_agents
    // Active means: not deleted AND not in our unusedAgents list
    const isConnectedToActiveAgent = await configurationsCollection
      .aggregate([
        {
          $match: {
            deletedAt: null,
            connected_agents: { $exists: true, $ne: null }
          }
        },
        {
          $project: {
            _id: 1,
            name: 1,
            last_used: 1,
            created_at: 1,
            isConnected: {
              $anyElementTrue: {
                $map: {
                  input: { $objectToArray: "$connected_agents" },
                  as: "agent",
                  in: { $eq: ["$$agent.v.bridge_id", agentId] }
                }
              }
            }
          }
        },
        {
          $match: {
            isConnected: true
          }
        }
      ])
      .toArray();

    // Filter out parent agents that are also in the unused list
    const activeParentAgents = isConnectedToActiveAgent.filter((parent) => {
      const parentId = parent._id.toString();
      // Parent is active only if it's NOT in our unused agents list
      return !unusedAgentIds.has(parentId);
    });

    // Also check if referenced in any version's connected_agents
    // We need to check if the parent agent of that version is active
    const connectedVersions = await versionsCollection
      .aggregate([
        {
          $match: {
            deletedAt: null,
            connected_agents: { $exists: true, $ne: null }
          }
        },
        {
          $project: {
            _id: 1,
            parent_id: 1,
            isConnected: {
              $anyElementTrue: {
                $map: {
                  input: { $objectToArray: "$connected_agents" },
                  as: "agent",
                  in: { $eq: ["$$agent.v.bridge_id", agentId] }
                }
              }
            }
          }
        },
        {
          $match: {
            isConnected: true
          }
        }
      ])
      .toArray();

    // Filter versions whose parent agents are also unused
    const activeVersionConnections = connectedVersions.filter((version) => {
      const parentId = version.parent_id;
      // Version's parent is active only if it's NOT in our unused agents list
      return !unusedAgentIds.has(parentId);
    });

    if (activeParentAgents.length > 0 || activeVersionConnections.length > 0) {
      const parentNames = activeParentAgents.map((a) => a.name || a._id.toString()).join(", ");
      console.log(`  Skipping agent "${agent.name}" (${agentId}): Connected to active agents [${parentNames}]`);
      skippedAgents.push({
        agent_id: agentId,
        agent_name: agent.name,
        connected_to: activeParentAgents.map((a) => ({ id: a._id.toString(), name: a.name }))
      });
    } else {
      agentsToDelete.push(agent);
    }
  }

  console.log(`\nAgents that can be deleted: ${agentsToDelete.length}`);
  console.log(`Agents skipped (connected to ACTIVE agents that are still in use): ${skippedAgents.length}`);

  if (agentsToDelete.length === 0) {
    console.log("\n=== Migration completed: No agents can be deleted (all are connected to active agents that are still in use) ===");
    return;
  }

  // Extract agent IDs and org IDs
  const agentIds = agentsToDelete.map((agent) => agent._id.toString());
  const orgIds = [...new Set(agentsToDelete.map((agent) => agent.org_id))];

  console.log(`\nAffected org_ids: ${orgIds.length}`);
  console.log(`Agent IDs to delete: ${agentIds.length}`);

  const currentDate = new Date();

  // Step 2: Soft delete associated versions
  console.log("\n[Step 2] Soft deleting associated versions...");

  const versionsResult = await versionsCollection.updateMany(
    {
      parent_id: { $in: agentIds },
      deletedAt: null
    },
    { $set: { deletedAt: currentDate } }
  );
  console.log(`Soft deleted ${versionsResult.modifiedCount} versions`);

  // Step 3: Soft delete the agents themselves
  console.log("\n[Step 3] Soft deleting unused agents...");

  const agentsResult = await configurationsCollection.updateMany(
    {
      _id: { $in: agentsToDelete.map((a) => a._id) },
      deletedAt: null
    },
    { $set: { deletedAt: currentDate } }
  );
  console.log(`Soft deleted ${agentsResult.modifiedCount} agents`);

  // Step 4: Check each org and delete tools/knowledge bases if no agents remain
  console.log("\n[Step 4] Cleaning up tools and knowledge bases for orgs with no remaining agents...");

  let orgsWithNoAgents = [];
  let totalToolsDeleted = 0;
  let totalToolsDisabledInEmbed = 0;
  let totalKnowledgeBasesDeleted = 0;
  let totalRagResourcesDeleted = 0;
  let totalRagResourceDeleteFailures = 0;
  let totalOrgsDeletedFromMSG91 = 0;

  for (const orgId of orgIds) {
    // Check if this org still has any agents
    const remainingAgentsCount = await configurationsCollection.countDocuments({
      org_id: orgId,
      deletedAt: null
    });

    if (remainingAgentsCount === 0) {
      console.log(`\n  Org ${orgId}: No remaining agents`);
      orgsWithNoAgents.push(orgId);

      // Get all active tools for this org before soft deleting
      const toolsToDelete = await apicallsCollection.find({ org_id: orgId, deletedAt: null }).toArray();
      console.log(`    - Found ${toolsToDelete.length} tools to process`);

      // Generate embed token for this org
      const embedToken = generateEmbedToken(orgId);

      // Disable each tool in Viasocket embed system
      if (toolsToDelete.length > 0) {
        console.log(`    - Disabling tools in Viasocket embed system...`);
        let successCount = 0;
        let failCount = 0;

        for (const tool of toolsToDelete) {
          if (tool.script_id) {
            const result = await disableToolInEmbed(tool.script_id, embedToken);
            if (result.success) {
              successCount++;
            } else {
              failCount++;
            }
          }
        }

        console.log(`      ✓ Successfully disabled: ${successCount}`);
        if (failCount > 0) {
          console.log(`      ✗ Failed to disable: ${failCount} (will still delete from database)`);
        }
        totalToolsDisabledInEmbed += successCount;
      }

      // Soft delete tools from database
      const toolsResult = await apicallsCollection.updateMany({ org_id: orgId, deletedAt: null }, { $set: { deletedAt: currentDate } });
      console.log(`    - Soft deleted ${toolsResult.modifiedCount} tools from database`);
      totalToolsDeleted += toolsResult.modifiedCount;

      // Soft delete resources in Hippocampus for each RAG collection
      const ragCollections = await ragCollectionsCollection.find({ org_id: orgId, deletedAt: null }).toArray();
      if (ragCollections.length > 0) {
        console.log(`    - Found ${ragCollections.length} knowledge base collections to process`);
        for (const rag of ragCollections) {
          const resourceIds = rag.resource_ids || [];
          if (resourceIds.length > 0) {
            console.log(`      - Soft deleting ${resourceIds.length} resources for collection ${rag.collection_id || rag._id}...`);
            for (const resourceId of resourceIds) {
              const result = await deleteResourceInHippocampus(resourceId);
              if (result.success) {
                totalRagResourcesDeleted++;
              } else {
                totalRagResourceDeleteFailures++;
              }
            }
          }
        }
        console.log(`      ✓ Soft deleted ${totalRagResourcesDeleted} resources from Hippocampus`);
        if (totalRagResourceDeleteFailures > 0) {
          console.log(`      ✗ Failed to soft delete ${totalRagResourceDeleteFailures} resources from Hippocampus`);
        }
      }

      // Soft delete knowledge bases for this org
      const ragResult = await ragCollectionsCollection.updateMany({ org_id: orgId, deletedAt: null }, { $set: { deletedAt: currentDate } });
      console.log(`    - Soft deleted ${ragResult.modifiedCount} knowledge base collections`);
      totalKnowledgeBasesDeleted += ragResult.modifiedCount;

      // Delete organization from MSG91
      console.log(`    - Deleting org from MSG91 routes...`);
      const msg91Result = await deleteOrgFromMSG91(orgId);
      if (msg91Result.success) {
        if (!msg91Result.notFound) {
          console.log(`      ✓ Successfully deleted org from MSG91`);
          totalOrgsDeletedFromMSG91++;
        }
      } else {
        console.log(`      ✗ Failed to delete org from MSG91 (org may still exist there)`);
      }
    } else {
      console.log(`\n  Org ${orgId}: ${remainingAgentsCount} agents remaining (keeping tools and knowledge bases)`);
    }
  }

  // Step 5: Summary
  console.log("\n=== Migration Summary ===");
  console.log(`Agents soft deleted: ${agentsResult.modifiedCount}`);
  console.log(`Agents skipped (connected to active agents): ${skippedAgents.length}`);
  console.log(`Versions soft deleted: ${versionsResult.modifiedCount}`);
  console.log(`Tools disabled in Viasocket embed: ${totalToolsDisabledInEmbed}`);
  console.log(`Tools soft deleted from database: ${totalToolsDeleted}`);
  console.log(`Knowledge bases soft deleted: ${totalKnowledgeBasesDeleted}`);
  console.log(`RAG resources soft deleted in Hippocampus: ${totalRagResourcesDeleted}`);
  console.log(`RAG resource soft delete failures in Hippocampus: ${totalRagResourceDeleteFailures}`);
  console.log(`Organizations deleted from MSG91: ${totalOrgsDeletedFromMSG91}`);
  console.log(`Organizations with no remaining agents: ${orgsWithNoAgents.length}`);

  if (skippedAgents.length > 0) {
    console.log(`\nSkipped agents (connected to ACTIVE agents that are still in use):`);
    skippedAgents.forEach((skipped) => {
      const connectedTo = skipped.connected_to.map((c) => c.name || c.id).join(", ");
      console.log(`  - ${skipped.agent_name || skipped.agent_id} (connected to: ${connectedTo})`);
    });
  }

  if (orgsWithNoAgents.length > 0) {
    console.log(`\nOrg IDs with no remaining agents (deleted from MSG91):`);
    orgsWithNoAgents.forEach((orgId) => console.log(`  - ${orgId}`));
  }

  console.log("\n=== Migration completed successfully ===");
};

/**
 * Rollback migration - This cannot be rolled back as data is permanently deleted
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async () => {
  console.log("=== Rollback for delete_unused_agents migration ===");
  console.log("WARNING: This migration permanently deletes data and cannot be rolled back.");
  console.log("Please restore from a database backup if you need to recover the deleted data.");
  console.log("=== Rollback completed (no action taken) ===");
};
