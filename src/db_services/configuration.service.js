import configurationModel from "../mongoModel/Configuration.model.js";
import versionModel from "../mongoModel/BridgeVersion.model.js";
import apiCallModel from "../mongoModel/ApiCall.model.js";
import templateModel from "../mongoModel/Template.model.js";
import ChatBotModel from "../mongoModel/ChatBot.model.js";
import apikeyCredentialsModel from "../mongoModel/Api.model.js";
import { deleteInCache } from "../cache_service/index.js";
import models from "../../models/index.js";
import jwt from "jsonwebtoken";
import axios from "axios";
import { ObjectId } from "mongodb";
// import { getAgentData } from "../services/utils/getConfiguration.js";
import agentVersionService from "./agentVersion.service.js";

const cloneAgentToOrg = async (agent_id, to_shift_org_id, cloned_agents_map = null, depth = 0) => {
  try {
    // Initialize cloned_agents_map for tracking and prevent infinite loops
    if (cloned_agents_map === null) {
      cloned_agents_map = {};
    }

    // Prevent infinite recursion
    if (depth > 10) {
      console.warn(`Maximum recursion depth reached for agent_id: ${agent_id}`);
      return null;
    }

    // Check if this agent was already cloned
    if (agent_id in cloned_agents_map) {
      return cloned_agents_map[agent_id];
    }

    // Step 1: Get the original configuration
    const original_config = await configurationModel.findOne({ _id: new ObjectId(agent_id) }).lean();
    if (!original_config) {
      throw new Error("Agent not found");
    }

    // Step 2: Prepare new configuration data
    const new_config = { ...original_config };
    delete new_config._id;
    delete new_config.apikey_object_id;
    new_config.org_id = to_shift_org_id;
    new_config.versions = [];
    delete new_config.total_tokens;

    // Step 3: Insert new configuration
    const new_config_result = await new configurationModel(new_config).save();
    const new_agent_id = new_config_result._id;

    // Track this cloned agent to prevent infinite loops
    cloned_agents_map[agent_id] = {
      new_bridge_id: new_agent_id.toString(),
      original_bridge_id: agent_id
    };

    // Step 4: Clone all versions
    const cloned_version_ids = [];
    const version_id_mapping = {};
    if (original_config.versions && original_config.versions.length > 0) {
      for (const version_id of original_config.versions) {
        const original_version = await versionModel.findOne({ _id: new ObjectId(version_id) }).lean();
        if (original_version) {
          const new_version = { ...original_version };
          delete new_version._id;
          delete new_version.apikey_object_id;
          new_version.org_id = to_shift_org_id;
          new_version.parent_id = new_agent_id.toString();

          const new_version_result = await new versionModel(new_version).save();
          const new_version_id = new_version_result._id.toString();
          cloned_version_ids.push(new_version_id);
          version_id_mapping[version_id] = new_version_id;
        }
      }
    }

    // Step 5: Update the new configuration with cloned version IDs and published_version_id
    const update_data = { versions: cloned_version_ids };
    if (original_config.published_version_id && version_id_mapping[original_config.published_version_id]) {
      update_data.published_version_id = version_id_mapping[original_config.published_version_id];
    }

    await configurationModel.updateOne({ _id: new_agent_id }, { $set: update_data });

    // Step 6: Clone related API calls (functions) using external API
    const cloned_function_ids = [];
    if (original_config.function_ids && original_config.function_ids.length > 0) {
      for (const function_id of original_config.function_ids) {
        const original_api_call = await apiCallModel.findOne({ _id: new ObjectId(function_id) }).lean();
        if (original_api_call && original_api_call.script_id) {
          try {
            const payload = {
              org_id: process.env.ORG_ID,
              project_id: process.env.PROJECT_ID,
              user_id: to_shift_org_id
            };
            const auth_token = jwt.sign(payload, process.env.ACCESS_KEY, { algorithm: "HS256" });

            const duplicate_url = `https://flow-api.viasocket.com/embed/duplicateflow/${original_api_call.script_id}`;
            const headers = {
              Authorization: auth_token,
              "Content-Type": "application/json"
            };
            const json_body = {
              title: "",
              meta: ""
            };

            const response = await axios.post(duplicate_url, json_body, { headers });
            const duplicate_data = response.data;

            if (duplicate_data.success && duplicate_data.data) {
              const new_api_call = { ...original_api_call };
              delete new_api_call._id;
              new_api_call.org_id = to_shift_org_id;
              new_api_call.script_id = duplicate_data.data.id;
              new_api_call.bridge_ids = [new_agent_id.toString()];
              new_api_call.updated_at = new Date();

              const new_api_call_result = await new apiCallModel(new_api_call).save();
              cloned_function_ids.push(new_api_call_result._id.toString());
            } else {
              console.error(`Failed to duplicate function ${original_api_call.script_id}:`, duplicate_data);
            }
          } catch (e) {
            console.error(`Error duplicating function ${original_api_call.script_id || function_id}:`, e);
            // Fallback
            const new_api_call = { ...original_api_call };
            delete new_api_call._id;
            new_api_call.org_id = to_shift_org_id;
            new_api_call.bridge_ids = [new_agent_id.toString()];
            new_api_call.updated_at = new Date();

            const new_api_call_result = await new apiCallModel(new_api_call).save();
            cloned_function_ids.push(new_api_call_result._id.toString());
          }
        }
      }
    }

    // Step 7: Update configuration and versions with cloned function IDs
    if (cloned_function_ids.length > 0) {
      await configurationModel.updateOne({ _id: new_agent_id }, { $set: { function_ids: cloned_function_ids } });

      for (const version_id of cloned_version_ids) {
        await versionModel.updateOne({ _id: new ObjectId(version_id) }, { $set: { function_ids: cloned_function_ids } });
      }
    }

    // Step 8: Handle connected agents recursively
    const cloned_connected_agents = {};
    const connected_agents_info = [];

    if (original_config.connected_agents) {
      for (const [agent_name, agent_info] of Object.entries(original_config.connected_agents)) {
        const connected_agent_id = agent_info.bridge_id;
        if (connected_agent_id) {
          try {
            const connected_result = await cloneAgentToOrg(connected_agent_id, to_shift_org_id, cloned_agents_map, depth + 1);

            if (connected_result) {
              cloned_connected_agents[agent_name] = {
                bridge_id: connected_result.new_bridge_id
              };
              connected_agents_info.push({
                agent_name: agent_name,
                original_bridge_id: connected_agent_id,
                new_bridge_id: connected_result.new_bridge_id
              });
            }
          } catch (e) {
            console.error(`Error cloning connected agent ${agent_name} (agent_id: ${connected_agent_id}):`, e);
          }
        }
      }
    }

    // Check for connected_agents in versions and update them too
    for (const version_id of cloned_version_ids) {
      const original_version = await versionModel.findOne({ _id: new ObjectId(version_id) }).lean();
      if (original_version && original_version.connected_agents) {
        const version_connected_agents = {};
        for (const [agent_name] of Object.entries(original_version.connected_agents)) {
          if (cloned_connected_agents[agent_name]) {
            version_connected_agents[agent_name] = cloned_connected_agents[agent_name];
          }
        }

        if (Object.keys(version_connected_agents).length > 0) {
          await versionModel.updateOne({ _id: new ObjectId(version_id) }, { $set: { connected_agents: version_connected_agents } });
        }
      }
    }

    if (Object.keys(cloned_connected_agents).length > 0) {
      await configurationModel.updateOne({ _id: new_agent_id }, { $set: { connected_agents: cloned_connected_agents } });
    }

    // Step 9: Get the final cloned configuration
    const cloned_config = await configurationModel.findOne({ _id: new_agent_id }).lean();
    cloned_config._id = cloned_config._id.toString();

    if (cloned_config.function_ids) {
      cloned_config.function_ids = cloned_config.function_ids.map((fid) => fid.toString());
    }

    return {
      success: true,
      message: "Agent cloned successfully",
      cloned_agent: cloned_config,
      original_bridge_id: agent_id,
      new_bridge_id: new_agent_id.toString(),
      cloned_versions: cloned_version_ids,
      cloned_functions: cloned_function_ids,
      connected_agents: connected_agents_info,
      recursion_depth: depth
    };
  } catch (error) {
    console.error(`Error in cloneAgentToOrg: ${error}`);
    throw error;
  }
};

const getAgentsWithSelectedData = async (agent_id) => {
  try {
    const agents = await configurationModel
      .findOne(
        {
          _id: agent_id
        },
        {
          is_api_call: 0,
          created_at: 0,
          api_endpoints: 0,
          __v: 0,
          bridge_id: 0
        }
      )
      .lean();
    return {
      success: true,
      bridges: agents
    };
  } catch (error) {
    console.error("error:", error);
    return {
      success: false,
      error: "something went wrong!!"
    };
  }
};

const deleteAgent = async (agent_id, org_id) => {
  try {
    // First, find the agent to get its data including versions
    const agent = await configurationModel.findOne({
      _id: new ObjectId(agent_id),
      org_id: org_id
      // Remove deletedAt filter to allow re-processing of already soft-deleted agents
    });
    if (!agent) {
      return {
        success: false,
        error: "Agent not found"
      };
    }

    // Use aggregation pipeline to find connected agents from both versions and configurations
    const [connectedFromVersions, connectedFromConfigurations] = await Promise.all([
      // Check versions for connected_agents
      versionModel.aggregate([
        {
          $match: {
            org_id: org_id,
            connected_agents: { $exists: true, $ne: null }
          }
        },
        {
          $addFields: {
            hasConnection: {
              $anyElementTrue: {
                $map: {
                  input: { $objectToArray: "$connected_agents" },
                  as: "agent",
                  in: { $eq: ["$$agent.v.bridge_id", agent_id] }
                }
              }
            },
            bridgeId: { $ifNull: ["$parent_id", "$_id"] }
          }
        },
        {
          $match: { hasConnection: true }
        },
        {
          $group: { _id: "$bridgeId" }
        }
      ]),

      // Check configurations (agents) for connected_agents
      configurationModel.aggregate([
        {
          $match: {
            org_id: org_id,
            connected_agents: { $exists: true, $ne: null }
          }
        },
        {
          $addFields: {
            hasConnection: {
              $anyElementTrue: {
                $map: {
                  input: { $objectToArray: "$connected_agents" },
                  as: "agent",
                  in: { $eq: ["$$agent.v.bridge_id", agent_id] }
                }
              }
            }
          }
        },
        {
          $match: { hasConnection: true }
        },
        {
          $group: { _id: "$_id" }
        }
      ])
    ]);

    // Combine and get unique agent IDs
    const allConnectedAgentIds = [...connectedFromVersions.map((item) => item._id), ...connectedFromConfigurations.map((item) => item._id)];

    const uniqueAgentIds = [...new Set(allConnectedAgentIds.map((id) => id.toString()))];

    if (uniqueAgentIds.length > 0) {
      // Get agent names for all connected agents
      const connectedAgents = await configurationModel
        .find({
          _id: { $in: uniqueAgentIds.map((id) => new ObjectId(id)) },
          org_id: org_id
        })
        .select({ _id: 1, name: 1 })
        .lean();

      const agentNames = connectedAgents.map((agent) => agent.name || `Agent ${agent._id}`);

      return {
        success: false,
        error: `Cannot delete agent. It is connected to the following ${agentNames.length === 1 ? "agent" : "agents"}: ${agentNames.join(", ")}`
      };
    }

    const currentDate = new Date();
    let agentAlreadyDeleted = false;

    // Check if agent is already soft deleted
    if (agent.deletedAt) {
      agentAlreadyDeleted = true;
    }

    // Soft delete the main agent by setting deletedAt (or update the deletedAt timestamp)
    const deletedAgent = await configurationModel.findOneAndUpdate(
      {
        _id: agent_id,
        org_id: org_id
      },
      {
        $set: {
          deletedAt: currentDate
        }
      },
      { new: true }
    );
    // Find and soft delete all versions associated with this agent using versions array
    let deletedVersions = { modifiedCount: 0 };

    // Use deletedAgent.versions as it contains the most up-to-date data
    const versionsToDelete = deletedAgent.versions || agent.versions;

    if (versionsToDelete && versionsToDelete.length > 0) {
      // Convert string IDs to ObjectIds if needed
      const versionIds = versionsToDelete.map((id) => new ObjectId(id));

      deletedVersions = await versionModel.updateMany(
        {
          _id: { $in: versionIds }, // Use converted ObjectIds
          deletedAt: null // Only update non-deleted versions
        },
        {
          $set: {
            deletedAt: currentDate
          }
        }
      );
    }
    const statusMessage = agentAlreadyDeleted
      ? `Agent ID: ${agent_id} was already soft deleted, updated timestamp. ${deletedVersions.modifiedCount} versions marked for deletion.`
      : `Agent ID: ${agent_id} and ${deletedVersions.modifiedCount} versions marked for deletion. They will be permanently deleted after 30 days.`;

    return {
      success: true,
      message: statusMessage
    };
  } catch (error) {
    console.error("error:", error);
    return {
      success: false,
      error: "something went wrong!!"
    };
  }
};

const restoreAgent = async (agent_id, org_id) => {
  try {
    // First, find the soft-deleted agent
    const agent = await configurationModel.findOne({
      _id: agent_id,
      org_id: org_id,
      deletedAt: { $ne: null } // Only find soft-deleted agents
    });

    if (!agent) {
      return {
        success: false,
        error: "Agent not found or not deleted"
      };
    }

    // Restore the main agent by removing deletedAt
    const restoredAgent = await configurationModel.findOneAndUpdate(
      {
        _id: agent_id,
        org_id: org_id
      },
      {
        $unset: {
          deletedAt: ""
        }
      },
      { new: true }
    );

    // Restore all versions associated with this agent using versions array
    let restoredVersions = { modifiedCount: 0 };

    // Use agent.versions to find versions to restore
    const versionsToRestore = agent.versions;

    if (versionsToRestore && versionsToRestore.length > 0) {
      // Convert string IDs to ObjectIds if needed
      const versionIds = versionsToRestore.map((id) => new ObjectId(id));

      restoredVersions = await versionModel.updateMany(
        {
          _id: { $in: versionIds }, // Use version IDs from the versions array
          deletedAt: { $ne: null } // Only restore soft-deleted versions
        },
        {
          $unset: {
            deletedAt: ""
          }
        }
      );
    }

    return {
      success: true,
      bridge: restoredAgent,
      restoredVersionsCount: restoredVersions.modifiedCount,
      message: `Agent and ${restoredVersions.modifiedCount} versions restored successfully.`
    };
  } catch (error) {
    console.error("restore agent error:", error);
    return {
      success: false,
      error: "something went wrong!!"
    };
  }
};

const getApiCallById = async (apiId) => {
  try {
    const apiCall = await apiCallModel.findById(apiId);
    return {
      success: true,
      apiCall: apiCall
    };
  } catch (error) {
    console.error("error:", error);
    return {
      success: false,
      error: "something went wrong!!"
    };
  }
};
const addResponseIdinAgent = async (agentId, orgId, responseId, responseRefId) => {
  try {
    const agents = await configurationModel.findOneAndUpdate(
      {
        _id: agentId
      },
      {
        $addToSet: {
          responseIds: responseId
        },
        $set: {
          responseRef: responseRefId
        }
      },
      {
        new: true
      }
    );
    return {
      success: true,
      bridges: agents
    };
  } catch (error) {
    console.log("error:", error);
    return {
      success: false,
      error: "something went wrong!!"
    };
  }
};

// add action  or update the previous action in agent

const addActionInAgent = async (agentId, actionId, actionJson, version_id) => {
  try {
    const model = version_id ? versionModel : configurationModel;
    const id_to_use = version_id ? version_id : agentId;

    const agents = await model
      .findOneAndUpdate(
        { _id: id_to_use },
        {
          $set: {
            [`actions.${actionId}`]: actionJson,
            is_drafted: true
          }
        },
        { new: true }
      )
      .lean();
    return agents;
  } catch (error) {
    throw new Error(error?.message);
  }
};

// remove action from agent

const removeActionInAgent = async (agentId, actionId, version_id) => {
  try {
    const model = version_id ? versionModel : configurationModel;
    const id_to_use = version_id ? version_id : agentId;
    const agents = await model
      .findOneAndUpdate(
        { _id: id_to_use },
        {
          $unset: {
            [`actions.${actionId}`]: "",
            is_drafted: true
          }
        },
        { new: true }
      )
      .lean();
    return agents;
  } catch (error) {
    console.log(error);
    throw new Error(error?.message);
  }
};

// get agent with slugname

const getAgentIdBySlugname = async (orgId, slugName) => {
  return await configurationModel
    .findOne({
      slugName: slugName,
      org_id: orgId
    })
    .select({ _id: 1, slugName: 1, starterQuestion: 1, IsstarterQuestionEnable: 1 })
    .lean();
};
const getAgentBySlugname = async (orgId, slugName, versionId) => {
  try {
    const hello_id = await configurationModel
      .findOne({
        slugName: slugName,
        org_id: orgId
      })
      .select({ hello_id: 1, "configuration.model": 1, service: 1, apikey_object_id: 1 })
      .lean();

    const modelConfig = await versionModel
      .findOne({
        _id: new ObjectId(versionId)
      })
      .select({ "configuration.model": 1, service: 1, apikey_object_id: 1 })
      .lean();

    const model = versionId ? modelConfig.configuration : hello_id?.configuration;
    const service = versionId ? modelConfig.service : hello_id?.service;
    const apikey_object_id = versionId ? modelConfig.apikey_object_id : hello_id?.apikey_object_id;

    if (!hello_id) return false;

    return { hello_id, modelConfig: model, apikey_object_id, service };
  } catch (error) {
    console.log("error:", error);
    return {
      success: false,
      error: "something went wrong!!"
    };
  }
};

const getAgentsByUserId = async (orgId, userId, agent_id) => {
  try {
    const query = { org_id: orgId };
    if (userId) {
      query.user_id = String(userId);
    }
    if (agent_id) {
      query._id = agent_id;
    }
    const agents = await configurationModel.find(query, {
      _id: 1,
      name: 1,
      service: 1,
      "configuration.model": 1,
      "configuration.prompt": 1,
      bridgeType: 1,
      slugName: 1,
      variables_state: 1,
      meta: 1,
      deletedAt: 1
    });
    return agents.map((agent) => {
      const agentData = agent._doc;
      const filtered = {};
      for (const [key, value] of Object.entries(agentData)) {
        if (value === null || value === undefined) {
          continue;
        }
        filtered[key] = value;
      }
      return filtered;
    });
  } catch (error) {
    console.error("Error fetching agents:", error);
    return { success: false, error: "Agent not found!!" };
  }
};

const removeResponseIdinAgent = async (agentId, orgId, responseId) => {
  try {
    const agents = await configurationModel.findOneAndUpdate(
      { _id: agentId },
      {
        $pull: {
          responseIds: responseId
        }
      },
      { new: true }
    );
    return { success: true, bridges: agents };
  } catch (error) {
    console.log("error:", error);
    return { success: false, error: "something went wrong!!" };
  }
};

const findChatbotOfAgent = async (orgId, agentId) => {
  try {
    const agents = await ChatBotModel.find({
      orgId: orgId,
      bridge: agentId
    });
    return {
      success: true,
      bridges: agents
    };
  } catch (error) {
    console.log("error:", error);
    return {
      success: false,
      error: "something went wrong!!"
    };
  }
};

const gettemplateById = async (template_id) => {
  try {
    return await templateModel.findById(template_id);
  } catch (error) {
    console.error("template_id error=>", error);
    return null;
  }
};
const getAgents = async (agent_id, org_id = null, version_id = null) => {
  try {
    const model = version_id ? versionModel : configurationModel;
    const id_to_use = version_id ? version_id : agent_id;

    const pipeline = [
      {
        $match: {
          _id: new ObjectId(id_to_use),
          ...(org_id && { org_id: org_id })
        }
      },
      {
        $project: {
          "configuration.encoded_prompt": 0
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
          }
        }
      }
    ];

    const result = await model.aggregate(pipeline);

    if (!result || result.length === 0) {
      throw new Error("No matching records found");
    }

    return {
      success: true,
      bridges: result[0]
    };
  } catch (error) {
    console.error(`Error in getAgents: ${error}`);
    return {
      success: false,
      error: "something went wrong!!"
    };
  }
};

const getAgentNameById = async (agent_id, org_id) => {
  try {
    const agent = await configurationModel.findOne({ _id: agent_id, org_id: org_id }, { name: 1 }).lean();
    if (!agent) {
      return "";
    }
    return agent.name;
  } catch (error) {
    console.error("Error fetching agent name =>", error);
    return "";
  }
};

const getAgentByUrlSlugname = async (url_slugName) => {
  try {
    const hello_id = await configurationModel
      .findOne({
        "page_config.url_slugname": url_slugName
      })
      .select({ _id: 1, name: 1, service: 1, org_id: 1 });

    if (!hello_id) return false;

    return {
      _id: hello_id._id,
      name: hello_id.name,
      service: hello_id.service,
      org_id: hello_id.org_id
    };
  } catch (error) {
    console.log("error:", error);
    return {
      success: false,
      error: "something went wrong!!"
    };
  }
};

const findIdsByModelAndService = async (model, service, org_id) => {
  const query = {
    "configuration.model": model
  };
  if (service) query.service = service;
  if (org_id) query.org_id = org_id;

  // Find matching configurations in configurationModel
  const configMatches = await configurationModel
    .find(query)
    .select({
      _id: 1,
      name: 1
    })
    .lean();

  // Find matching configurations in versionModel
  const versionMatches = await versionModel
    .find(query)
    .select({
      _id: 1,
      name: 1
    })
    .lean();

  // Prepare result object
  const result = {
    agents: configMatches.map((item) => ({
      id: item._id.toString(),
      name: item.name || "Unnamed Agent"
    })),
    versions: versionMatches.map((item) => ({
      id: item._id.toString()
    }))
  };

  return {
    success: true,
    data: result
  };
};

const getAllAgentsData = async (userEmail) => {
  const query = {
    $or: [
      { "page_config.availability": "public" },
      {
        "page_config.availability": "private",
        "page_config.allowedUsers": userEmail
      }
    ]
  };
  return await configurationModel.find(query);
};

const getAgentsData = async (slugName, userEmail) => {
  return await configurationModel.findOne({
    $or: [
      {
        $and: [{ "page_config.availability": "public" }, { "page_config.url_slugname": slugName }]
      },
      {
        $and: [{ "page_config.availability": "private" }, { "page_config.url_slugname": slugName }, { "page_config.allowedUsers": userEmail }]
      }
    ]
  });
};

const getAgentsAndVersionsByModel = async (model_name) => {
  try {
    const agents = await configurationModel.find({ "configuration.model": model_name }, { org_id: 1, name: 1, _id: 1, versions: 1 }).lean();

    return agents.map((agent) => {
      const { _id, ...rest } = agent;
      return {
        ...rest,
        bridge_id: _id.toString()
      };
    });
  } catch (error) {
    console.error(`Error in get_agents_and_versions_by_model: ${error}`);
    throw error;
  }
};

const getAgentsWithoutTools = async (agent_id, org_id, version_id = null) => {
  try {
    const model = version_id ? versionModel : configurationModel;
    const id_to_use = version_id ? version_id : agent_id;

    const agent = await model.findOne({ _id: new ObjectId(id_to_use) }).lean();

    if (!agent) {
      throw new Error("No matching agent found");
    }

    return {
      success: true,
      bridges: agent
    };
  } catch (error) {
    console.error(`Error in getAgentsWithoutTools: ${error}`);
    throw error;
  }
};

const updateBuiltInTools = async (version_id, tool, add = 1) => {
  const to_update = { $set: { status: 1 } };
  if (add === 1) {
    to_update.$addToSet = { built_in_tools: tool };
  } else {
    to_update.$pull = { built_in_tools: tool };
  }

  const data = await versionModel.findOneAndUpdate({ _id: new ObjectId(version_id) }, to_update, {
    new: true,
    upsert: true
  });

  if (!data) {
    return {
      success: false,
      error: "No records updated or version not found"
    };
  }

  if (!data.built_in_tools) {
    data.built_in_tools = [];
  }

  return data;
};

const updateAgents = async (version_id, agents, add = 1) => {
  let to_update;
  if (add === 1) {
    // Add or update the connected agents
    const setFields = {};
    for (const [agent_name, agent_info] of Object.entries(agents)) {
      agent_info.thread_id = true;
      setFields[`connected_agents.${agent_name}`] = agent_info;
    }
    to_update = { $set: setFields };
  } else {
    // Remove the specified connected agents
    const unsetFields = {};
    for (const agent_name of Object.keys(agents)) {
      unsetFields[`connected_agents.${agent_name}`] = "";
    }
    to_update = { $unset: unsetFields };
  }

  const data = await versionModel.findOneAndUpdate({ _id: new ObjectId(version_id) }, to_update, {
    new: true,
    upsert: true
  });

  if (!data) {
    throw new Error("No records updated or version not found");
  }

  if (!data.connected_agents) {
    data.connected_agents = {};
  }

  return data;
};

const updateAgentIdsInApiCalls = async (function_id, agent_id, add = 1) => {
  const to_update = { $set: { status: 1 } };
  if (add === 1) {
    to_update.$addToSet = { bridge_ids: new ObjectId(agent_id) };
  } else {
    to_update.$pull = { bridge_ids: new ObjectId(agent_id) };
  }

  const data = await apiCallModel.findOneAndUpdate({ _id: new ObjectId(function_id) }, to_update, {
    new: true,
    upsert: true
  });

  if (!data) {
    return {
      success: false,
      error: "No records updated or agent not found"
    };
  }

  const result = data.toObject ? data.toObject() : data;
  result._id = result._id.toString();
  if (result.bridge_ids) {
    result.bridge_ids = result.bridge_ids.map((bid) => bid.toString());
  }

  return result;
};

const getApikeyCreds = async (org_id, apikey_object_ids) => {
  for (const [service, object_id] of Object.entries(apikey_object_ids)) {
    const apikey_cred = await apikeyCredentialsModel.findOne({ _id: new ObjectId(object_id), org_id: org_id }, { apikey: 1 });
    if (!apikey_cred) {
      throw new Error(`Apikey for ${service} not found`);
    }
  }
};

const updateApikeyCreds = async (version_id, apikey_object_ids) => {
  try {
    if (apikey_object_ids && typeof apikey_object_ids === "object") {
      // First, remove the version_id from any apikeycredentials documents that contain it
      await apikeyCredentialsModel.updateMany({ version_ids: version_id }, { $pull: { version_ids: version_id } });

      for (const [, api_key_id] of Object.entries(apikey_object_ids)) {
        await apikeyCredentialsModel.updateOne({ _id: new ObjectId(api_key_id) }, { $addToSet: { version_ids: version_id } }, { upsert: true });
      }
    }
    return true;
  } catch (error) {
    console.error(`Error in updateApikeyCreds: ${error}`);
    throw error;
  }
};

const createAgent = async (data) => {
  const agent = new configurationModel(data);
  const result = await agent.save();
  return { bridge: result };
};

const updateAgent = async (agent_id, update_fields, version_id = null) => {
  const model = version_id ? versionModel : configurationModel;
  const id_to_use = version_id ? version_id : agent_id;
  const result = await model.findOneAndUpdate({ _id: id_to_use }, { $set: update_fields }, { new: true });

  const cacheKeysToDelete = agentVersionService._buildCacheKeys(version_id, agent_id || result.parent_id, { bridges: [], versions: [] }, []);

  if (cacheKeysToDelete.length > 0) {
    await deleteInCache(cacheKeysToDelete);
  }

  return { result };
};

const getAgentsWithTools = async (agent_id, org_id, version_id = null) => {
  try {
    // const cacheKey = `${redis_keys.bridge_data_with_tools_}${version_id || agent_id}`;
    // const cachedData = await findInCache(cacheKey);
    // if (cachedData) {
    //   return JSON.parse(cachedData);
    // }

    const model = version_id ? versionModel : configurationModel;
    const id_to_use = version_id ? version_id : agent_id;

    if (!ObjectId.isValid(id_to_use)) {
      throw new Error("Invalid Agent ID provided");
    }

    const pipeline = [
      {
        $match: {
          _id: new ObjectId(id_to_use),
          org_id: org_id
        }
      },
      {
        $project: {
          "configuration.encoded_prompt": 0
        }
      },
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

    const result = await model.aggregate(pipeline);

    if (!result || result.length === 0) {
      throw new Error("No matching agent found");
    }

    const response = {
      success: true,
      bridges: result[0]
    };

    // await storeInCache(cacheKey, response);
    return response;
  } catch (error) {
    console.error(`Error in getAgentsWithTools: ${error}`);
    throw error;
  }
};

const getAllAgentsInOrg = async (org_id, folder_id, user_id, isEmbedUser) => {
  // First, get all bridge_ids and their last publishers from PostgreSQL
  const lastPublishersMap = await getAllAgentsWithLastPublishers(org_id);

  // Build MongoDB query
  const query = { org_id: org_id };
  if (folder_id) {
    try {
      if (ObjectId.isValid(folder_id)) {
        query.folder_id = folder_id;
      } else {
        console.warn("Invalid folder_id passed to getAllAgentsInOrg:", folder_id);
      }
    } catch (e) {
      console.error("Error validating folder_id:", e);
    }
  } else {
    // When folder_id is not provided, only get agents without a folder_id
    query.folder_id = null;
  }
  if (user_id && isEmbedUser) query.user_id = user_id;

  // Get agents from MongoDB
  const agents = await configurationModel
    .find(query)
    .select({
      _id: 1,
      name: 1,
      service: 1,
      org_id: 1,
      user_id: 1,
      "configuration.model": 1,
      "configuration.prompt": 1,
      bridgeType: 1,
      slugName: 1,
      status: 1,
      versions: 1,
      published_version_id: 1,
      total_tokens: 1,
      variables_state: 1,
      agent_variables: 1,
      bridge_status: 1,
      connected_agents: 1,
      function_ids: 1,
      connected_agent_details: 1,
      bridge_summary: 1,
      deletedAt: 1,
      bridge_limit: 1,
      bridge_usage: 1,
      bridge_limit_reset_period: 1,
      bridge_limit_start_date: 1,
      last_used: 1,
      variables_path: 1,
      users: 1,
      createdAt: 1,
      updatedAt: 1,
      prompt_total_tokens: 1,
      prompt_enhancer_percentage: 1
    })
    .sort({ createdAt: -1 })
    .lean();

  // Process agents and assign last publisher data
  const processedAgents = agents.map((agent) => {
    agent._id = agent._id.toString();
    agent.bridge_id = agent._id; // Alias _id as bridge_id
    if (agent.function_ids) {
      agent.function_ids = agent.function_ids.map((id) => id.toString());
    }
    if (agent.published_version_id) {
      agent.published_version_id = agent.published_version_id.toString();
    }

    // Get the last publisher from the PostgreSQL result
    if (lastPublishersMap[agent._id]) {
      agent.last_publisher_id = lastPublishersMap[agent._id];
    }
    return agent;
  });

  return processedAgents;
};

// Get all agents with their last publishers for an organization in a single query
const getAllAgentsWithLastPublishers = async (org_id) => {
  // Simple query to get all bridge_ids and their last publishers for the organization
  const agentsWithPublishers = await models.pg.sequelize.query(
    `
      SELECT DISTINCT ON (bridge_id) 
             bridge_id, 
             user_id as last_publisher_id
      FROM user_bridge_config_history 
      WHERE org_id = :org_id 
        AND type = 'Version published'
      ORDER BY bridge_id, time DESC
    `,
    {
      replacements: { org_id },
      type: models.pg.sequelize.QueryTypes.SELECT
    }
  );

  // Create a map of bridge_id -> last_publisher_id
  const publishersMap = {};
  agentsWithPublishers.forEach((agent) => {
    publishersMap[agent.bridge_id] = agent.last_publisher_id;
  });

  return publishersMap;
};

const getAgentUsers = async (agent_id, org_id) => {
  try {
    const agent = await configurationModel.findOne({ _id: new ObjectId(agent_id), org_id: org_id }, { users: 1 }).lean();

    return agent ? agent.users : null;
  } catch (error) {
    console.error(`Error fetching agent users: ${error}`);
    return null;
  }
};

export default {
  deleteAgent,
  restoreAgent,
  getApiCallById,
  getAgentsWithSelectedData,
  addResponseIdinAgent,
  removeResponseIdinAgent,
  getAgentBySlugname,
  findChatbotOfAgent,
  getAgentIdBySlugname,
  gettemplateById,
  getAllAgentsWithLastPublishers,
  addActionInAgent,
  removeActionInAgent,
  getAgents,
  getAgentNameById,
  getAgentByUrlSlugname,
  findIdsByModelAndService,
  getAgentsByUserId,
  getAllAgentsData,
  getAgentsData,
  getAgentsWithTools,
  getAllAgentsInOrg,
  createAgent,
  updateAgent,
  updateBuiltInTools,
  updateAgents,
  updateAgentIdsInApiCalls,
  getApikeyCreds,
  updateApikeyCreds,
  getAgentsAndVersionsByModel,
  getAgentsWithoutTools,
  cloneAgentToOrg,
  getAgentUsers
};
