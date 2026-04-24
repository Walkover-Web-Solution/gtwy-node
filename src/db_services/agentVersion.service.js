import mongoose from "mongoose";
import { encode } from "gpt-tokenizer";
import bridgeVersionModel from "../mongoModel/BridgeVersion.model.js";
import configurationModel from "../mongoModel/Configuration.model.js";
import apiCallModel from "../mongoModel/ApiCall.model.js";
import apikeyCredentialsModel from "../mongoModel/Api.model.js"; // Check if this is correct model for apikeycredentials
import testcasesHistoryModel from "../mongoModel/TestcaseHistory.model.js";
import conversationDbService from "./conversation.service.js";
import { deleteInCache } from "../cache_service/index.js";
import { callAiMiddleware } from "../services/utils/aiCall.utils.js";
import { redis_keys, bridge_ids } from "../configs/constant.js";
import { getReqOptVariablesInPrompt, transformAgentVariableToToolCallFormat } from "../utils/agentVariables.js";
import { convertPromptToString } from "../utils/promptWrapper.utils.js";
const ObjectId = mongoose.Types.ObjectId;

async function getVersion(version_id) {
  try {
    const version = await bridgeVersionModel.findById(version_id).lean();
    if (!version) return null;
    version._id = version._id.toString();
    if (version.parent_id) version.parent_id = version.parent_id.toString();
    return version;
  } catch (error) {
    console.error("Error fetching version:", error);
    return null;
  }
}

async function createAgentVersion(data) {
  try {
    const agentVersionData = data.toObject ? data.toObject() : { ...data };
    const keysToRemove = ["name", "slugName", "bridgeType"];
    keysToRemove.forEach((key) => delete agentVersionData[key]);

    agentVersionData.is_drafted = true;
    agentVersionData.parent_id = data.parent_id || data._id;
    delete agentVersionData._id; // Let Mongoose generate a new ID

    const newVersion = await bridgeVersionModel.create(agentVersionData);
    return newVersion.toObject();
  } catch (error) {
    console.error("Error creating agent version:", error);
    throw error;
  }
}

async function updateAgents(agent_id, data, version_id = null) {
  try {
    let result;
    const updateQuery = {};

    if (data.versions) {
      updateQuery.$addToSet = { versions: { $each: data.versions } };
      delete data.versions;
    }

    if (Object.keys(data).length > 0) {
      updateQuery.$set = data;
    }

    if (version_id) {
      result = await bridgeVersionModel.findOneAndUpdate({ _id: version_id }, updateQuery, { new: true });
    } else {
      result = await configurationModel.findOneAndUpdate({ _id: agent_id }, updateQuery, { new: true });
    }

    const cacheKeysToDelete = _buildCacheKeys(version_id, agent_id || result.parent_id, { bridges: [], versions: [] }, [], result.org_id);

    if (cacheKeysToDelete.length > 0) {
      await deleteInCache(cacheKeysToDelete);
    }
    return result;
  } catch (error) {
    console.error("Error updating agents:", error);
    throw error;
  }
}

async function getVersionWithTools(version_id) {
  try {
    const pipeline = [
      { $match: { _id: new ObjectId(version_id) } },
      {
        $lookup: {
          from: "apicalls",
          localField: "function_ids",
          foreignField: "_id",
          as: "apiCalls"
        }
      },
      {
        $addFields: {
          _id: { $toString: "$_id" },
          function_ids: {
            $map: {
              input: "$function_ids",
              as: "fid",
              in: { $toString: "$$fid" }
            }
          },
          apiCalls: {
            $arrayToObject: {
              $map: {
                input: "$apiCalls",
                as: "api_call",
                in: {
                  k: { $toString: "$$api_call._id" },
                  v: {
                    $mergeObjects: [
                      "$$api_call",
                      {
                        _id: { $toString: "$$api_call._id" },
                        bridge_ids: {
                          $map: {
                            input: "$$api_call.bridge_ids",
                            as: "bid",
                            in: { $toString: "$$bid" }
                          }
                        }
                      }
                    ]
                  }
                }
              }
            }
          }
        }
      }
    ];

    const result = await bridgeVersionModel.aggregate(pipeline);
    if (!result || result.length === 0) return null;

    return { success: true, bridges: result[0] };
  } catch (error) {
    console.error("Error fetching version with tools:", error);
    return null;
  }
}

async function makeQuestion(parent_id, prompt, functions, save = false) {
  if (functions) {
    const filteredFunctions = {};
    for (const key in functions) {
      filteredFunctions[functions[key].title] = functions[key].description;
    }
    prompt += "\nFunctionalities available\n" + JSON.stringify(filteredFunctions);
  }

  const expectedQuestions = await callAiMiddleware(prompt, bridge_ids["make_question"]);

  if (save) {
    await configurationModel.updateOne({ _id: parent_id }, { $set: { starterQuestion: expectedQuestions.questions || [] } });
  }
  return expectedQuestions;
}

// Helper functions for cleanup
async function _cleanupConnectedAgents(version_id, org_id) {
  const affectedIds = { versions: new Set(), bridges: new Set() };

  // Cleanup agents
  const agents = await configurationModel.find({ org_id, connected_agents: { $exists: true } });
  for (const agent of agents) {
    const connectedAgents = agent.connected_agents || {};
    let modified = false;
    const newAgents = {};

    for (const [key, info] of Object.entries(connectedAgents)) {
      if (info.version_id !== version_id) {
        newAgents[key] = info;
      } else {
        modified = true;
      }
    }

    if (modified) {
      await configurationModel.updateOne({ _id: agent._id }, { $set: { connected_agents: newAgents } });
      affectedIds.bridges.add(agent._id.toString());
    }
  }

  // Cleanup versions
  const versions = await bridgeVersionModel.find({ org_id, connected_agents: { $exists: true } });
  for (const version of versions) {
    const connectedAgents = version.connected_agents || {};
    let modified = false;
    const newAgents = {};

    for (const [key, info] of Object.entries(connectedAgents)) {
      if (info.version_id !== version_id) {
        newAgents[key] = info;
      } else {
        modified = true;
      }
    }

    if (modified) {
      await bridgeVersionModel.updateOne({ _id: version._id }, { $set: { connected_agents: newAgents } });
      affectedIds.versions.add(version._id.toString());
    }
  }

  return affectedIds;
}

async function _cleanupApiCalls(version_id) {
  const impacted = { bridges: new Set(), versions: new Set() };
  const apiCalls = await apiCallModel.find({ version_ids: version_id });

  for (const doc of apiCalls) {
    if (doc.bridge_ids) doc.bridge_ids.forEach((id) => impacted.bridges.add(id.toString()));
    if (doc.version_ids) doc.version_ids.forEach((id) => impacted.versions.add(id.toString()));
  }

  await apiCallModel.updateMany({ version_ids: version_id }, { $pull: { version_ids: version_id } });

  return impacted;
}

async function _cleanupApikeyCredentials(version_id) {
  // Assuming apikeyCredentialsModel exists and has version_ids
  if (apikeyCredentialsModel) {
    await apikeyCredentialsModel.updateMany({ version_ids: version_id }, { $pull: { version_ids: version_id } });
  }
}

async function _cleanupTestcaseHistory(version_id) {
  if (testcasesHistoryModel) {
    await testcasesHistoryModel.deleteMany({ version_id: version_id });
  }
}

function _collectRagCacheKeys(version_doc) {
  const cacheKeys = new Set();
  const docIds = version_doc.doc_ids || [];
  docIds.forEach((docId) => {
    if (typeof docId === "string") {
      cacheKeys.add(`${redis_keys["files_"]}${docId}`);
    }
  });
  return cacheKeys;
}

function _mergeImpactedIds(...impacts) {
  const merged = { bridges: new Set(), versions: new Set() };
  impacts.forEach((impact) => {
    if (!impact) return;
    impact.bridges.forEach((id) => merged.bridges.add(id));
    impact.versions.forEach((id) => merged.versions.add(id));
  });
  return merged;
}

function _buildCacheKeys(version_id, parent_id, impacted_ids, extra_keys, org_id) {
  const cacheKeys = new Set([
    `${redis_keys.get_bridge_data_}${org_id}_${version_id}`,
    `${redis_keys.bridge_data_with_tools_}${org_id}_${version_id}`
  ]);

  if (parent_id) {
    cacheKeys.add(`${redis_keys.get_bridge_data_}${org_id}_${parent_id}`);
    cacheKeys.add(`${redis_keys.bridge_data_with_tools_}${org_id}_${parent_id}`);
  }

  impacted_ids.bridges.forEach((id) => {
    cacheKeys.add(`${redis_keys.get_bridge_data_}${org_id}_${id}`);
    cacheKeys.add(`${redis_keys.bridge_data_with_tools_}${org_id}_${id}`);
  });

  impacted_ids.versions.forEach((id) => {
    cacheKeys.add(`${redis_keys.get_bridge_data_}${org_id}_${id}`);
    cacheKeys.add(`${redis_keys.bridge_data_with_tools_}${org_id}_${id}`);
  });

  extra_keys.forEach((key) => cacheKeys.add(key));
  return Array.from(cacheKeys);
}

function calculateTokens(text) {
  try {
    if (!text || typeof text !== "string") return 0;
    const tokens = encode(text);
    return tokens.length;
  } catch (error) {
    console.error("Error calculating tokens:", error);
    return 0;
  }
}

function calculatePromptTokens(prompt, tools) {
  try {
    let promptTokens = 0;
    let toolsTokens = 0;

    // Calculate tokens for prompt
    if (prompt) {
      promptTokens = calculateTokens(String(prompt));
    }

    // Calculate tokens for tools (handle both object, list and string formats)
    if (tools) {
      let toolsText = "";
      if (typeof tools === "object") {
        // Convert object or array to JSON string for token counting
        toolsText = JSON.stringify(tools);
      } else if (typeof tools === "string" && tools.trim()) {
        toolsText = tools;
      }

      if (toolsText) {
        toolsTokens = calculateTokens(toolsText);
      }
    }

    return promptTokens + toolsTokens;
  } catch (error) {
    console.error("Error calculating prompt tokens:", error);
    return 0;
  }
}

async function getPromptEnhancerPercentage(parentId, prompt) {
  try {
    if (!prompt) return null;

    const promptEnhancerResult = await callAiMiddleware(prompt, bridge_ids["prompt_checker"], { user_prompt: prompt }, null, null, null, true);
    const prompt_enhancer_percentage = promptEnhancerResult.OptimizationPotential;
    const criteria_check = promptEnhancerResult.CriteriaCheck;
    // Update the document in the configurationModel
    await configurationModel.updateOne(
      { _id: parentId },
      { $set: { prompt_enhancer_percentage: prompt_enhancer_percentage, criteria_check: criteria_check } }
    );

    return { prompt_enhancer_percentage, criteria_check };
  } catch (error) {
    console.error("Error getting prompt enhancer percentage:", error);
    return null;
  }
}

async function deleteAgentVersion(org_id, version_id) {
  if (!version_id) throw new Error("Invalid version id provided");

  const versionDoc = await bridgeVersionModel.findOne({ _id: version_id, org_id }).lean();
  if (!versionDoc) throw new Error("Version not found");

  const parentId = versionDoc.parent_id;
  if (parentId) {
    const parentConfig = await configurationModel.findOne({ _id: parentId, org_id }, { published_version_id: 1 });
    if (parentConfig && parentConfig.published_version_id === version_id) {
      throw new Error("Cannot delete the currently published version. Publish a different version first.");
    }
  }

  const connectedAgentsImpacted = await _cleanupConnectedAgents(version_id, org_id);

  if (parentId) {
    await configurationModel.updateOne({ _id: parentId }, { $pull: { versions: version_id } });
  }

  const apiCallsImpacted = await _cleanupApiCalls(version_id);
  await _cleanupApikeyCredentials(version_id);
  await _cleanupTestcaseHistory(version_id);

  const deleteResult = await bridgeVersionModel.deleteOne({ _id: version_id, org_id });
  if (deleteResult.deletedCount === 0) throw new Error("Failed to delete version");

  const ragCacheKeys = _collectRagCacheKeys(versionDoc);
  const impactedIds = _mergeImpactedIds(connectedAgentsImpacted, apiCallsImpacted);
  const cacheKeysToDelete = _buildCacheKeys(version_id, parentId, impactedIds, ragCacheKeys, org_id);

  if (cacheKeysToDelete.length > 0) {
    await deleteInCache(cacheKeysToDelete);
  }

  return { success: true, message: "Version deleted successfully" };
}

async function publish(org_id, version_id, user_id) {
  const versionDataResult = await getVersionWithTools(version_id);
  if (!versionDataResult || !versionDataResult.bridges) throw new Error("Version data not found");

  const getVersionData = versionDataResult.bridges;
  const parentId = getVersionData.parent_id;
  if (!parentId) throw new Error("Parent ID not found in version data");

  const parentConfiguration = await configurationModel.findById(parentId).lean();
  if (!parentConfiguration) throw new Error("Parent configuration not found");

  const publishedVersionId = getVersionData._id.toString();
  const previousPublishedVersionId = parentConfiguration.published_version_id;

  // Extract agent variables logic
  const prompt = convertPromptToString(getVersionData.configuration?.prompt || "");
  const variableState = getVersionData.variables_state || {};
  const variablePath = getVersionData.variables_path || {};

  if (Array.isArray(getVersionData.pre_tools)) {
    getVersionData.pre_tools.forEach((tool) => {
      if (tool.type === "custom_function" && tool.config && tool.config.script_id && tool.args) {
        variablePath[tool.config.script_id] = variablePath[tool.config.script_id] || {};
        Object.assign(variablePath[tool.config.script_id], tool.args);
      }
    });
  }

  const agentVariables = getReqOptVariablesInPrompt(prompt, variableState, variablePath);
  const transformedAgentVariables = transformAgentVariableToToolCallFormat(agentVariables);

  // Prepare updated configuration
  const updatedConfiguration = { ...parentConfiguration, ...getVersionData };
  delete updatedConfiguration._id;
  updatedConfiguration.published_version_id = publishedVersionId;
  delete updatedConfiguration.apiCalls; // Remove looked-up data

  const chatbotAutoAnswers = parentConfiguration.chatbot_auto_answers;

  // Restore the chatbot_auto_answers value from parent
  if (chatbotAutoAnswers !== undefined) {
    updatedConfiguration.chatbot_auto_answers = chatbotAutoAnswers;
  }

  if (updatedConfiguration.function_ids) {
    updatedConfiguration.function_ids = updatedConfiguration.function_ids.map((fid) => new ObjectId(fid));
  }

  // Update connected_agent_details with agent variables
  updatedConfiguration.connected_agent_details = {
    ...(updatedConfiguration.connected_agent_details || {}),
    agent_variables: {
      fields: transformedAgentVariables.fields,
      required_params: transformedAgentVariables.required_params
    }
  };

  const tools = getVersionData.apiCalls;

  // Calculate token count and include in transaction update (avoids a separate DB write)
  updatedConfiguration.prompt_total_tokens = calculatePromptTokens(prompt, tools);

  // Transaction
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await configurationModel.updateOne({ _id: parentId }, { $set: updatedConfiguration }, { session });

    await bridgeVersionModel.updateOne({ _id: publishedVersionId }, { $set: { is_drafted: false } }, { session });

    if (previousPublishedVersionId && previousPublishedVersionId.toString() !== publishedVersionId.toString()) {
      await bridgeVersionModel.updateOne({ _id: previousPublishedVersionId }, { $set: { is_drafted: true } }, { session });
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw new Error(`Failed to publish version: ${error.message}`);
  } finally {
    session.endSession();
  }

  // Background tasks (after transaction to avoid write conflicts on configurationModel)
  makeQuestion(parentId, prompt, tools, true).catch(console.error);
  getPromptEnhancerPercentage(parentId, prompt).catch(console.error);
  // deleteCurrentTestcaseHistory(version_id).catch(console.error); // Implement if needed

  const cacheKeysToDelete = _buildCacheKeys(publishedVersionId, parentId, { bridges: [], versions: [] }, [], org_id);
  if (cacheKeysToDelete.length > 0) {
    await deleteInCache(cacheKeysToDelete);
  }

  await conversationDbService.addBulkUserEntries([
    {
      user_id,
      org_id,
      bridge_id: parentId, // Database column name, keeping as bridge_id for compatibility
      version_id,
      type: "Version published"
    }
  ]);

  return { success: true, message: "Version published successfully" };
}

async function getAllConnectedAgents(id, org_id, type) {
  const agentsMap = {};
  const visited = new Set();

  async function fetchDocument(docId, docType) {
    try {
      let doc, actualType;
      if (docType === "bridge") {
        doc = await configurationModel.findOne({ _id: docId, org_id }).lean();
        actualType = "bridge";
      } else if (docType === "version") {
        doc = await bridgeVersionModel.findOne({ _id: docId, org_id }).lean();
        actualType = "version";
      } else {
        // Default to bridge if type is not specified
        doc = await configurationModel.findOne({ _id: docId, org_id }).lean();
        actualType = "bridge";
      }

      return { doc, type: actualType };
    } catch {
      return { doc: null, type: docType };
    }
  }

  async function processAgent(agentId, parentIds = [], docType = null) {
    if (visited.has(agentId)) {
      if (parentIds && agentsMap[agentId]) {
        parentIds.forEach((pid) => {
          if (!agentsMap[agentId].parentAgents.includes(pid)) {
            agentsMap[agentId].parentAgents.push(pid);
          }
        });
      }
      return;
    }

    visited.add(agentId);
    const { doc, type: actualType } = await fetchDocument(agentId, docType);

    if (!doc) {
      return;
    }

    const agentName = doc.name || `Agent_${agentId}`;
    const connectedAgentDetails = doc.connected_agent_details || {};
    const threadId = connectedAgentDetails.thread_id || false;
    const description = connectedAgentDetails.description;

    agentsMap[agentId] = {
      agent_name: agentName,
      parentAgents: parentIds || [],
      childAgents: [],
      thread_id: threadId,
      document_type: actualType
    };
    if (description) agentsMap[agentId].description = description;

    const connectedAgents = doc.connected_agents || {};

    for (const [, info] of Object.entries(connectedAgents)) {
      if (!info) {
        continue;
      }

      const childId = info.version_id || info.bridge_id;
      if (childId) {
        if (!agentsMap[agentId].childAgents.includes(childId)) {
          agentsMap[agentId].childAgents.push(childId);
        }
        const childType = info.version_id ? "version" : "bridge";
        await processAgent(childId, [agentId], childType);
      }
    }
  }

  await processAgent(id, null, type);

  return agentsMap;
}

export default {
  getVersion,
  createAgentVersion,
  createBridgeVersion: createAgentVersion, // Keep alias for backward compatibility
  updateAgents,
  updateBridges: updateAgents, // Keep alias for backward compatibility
  getVersionWithTools,
  publish,
  deleteAgentVersion,
  deleteBridgeVersion: deleteAgentVersion, // Keep alias for backward compatibility
  makeQuestion,
  getAllConnectedAgents,
  _buildCacheKeys
};
