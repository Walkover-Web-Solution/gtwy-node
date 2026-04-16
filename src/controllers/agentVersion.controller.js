import agentVersionDbService from "../db_services/agentVersion.service.js";
import ConfigurationServices from "../db_services/configuration.service.js";
import folderDbService from "../db_services/folder.service.js";
import conversationDbService from "../db_services/conversation.service.js";
import { modelConfigDocument } from "../services/utils/loadModelConfigs.js";
import { selectBestModel } from "../services/utils/notDiamond.utils.js";

const { addBulkUserEntries } = conversationDbService;

const createVersion = async (req, res, next) => {
  const { version_id, version_description } = req.body;
  const org_id = req.profile.org.id;
  const user_id = req.profile.user.id;

  const agentData = await ConfigurationServices.getAgentsWithoutTools(null, org_id, version_id);

  if (agentData.bridges && agentData.bridges.deletedAt) {
    res.locals = { success: false, message: "Cannot create version for a deleted agent" };
    req.statusCode = 400;
    return next();
  }

  const parent_id = agentData.bridges.parent_id;
  const agentVersionData = { ...agentData.bridges, version_description, user_id };

  const newVersion = await agentVersionDbService.createAgentVersion(agentVersionData);
  const create_new_version = newVersion._id.toString();
  await agentVersionDbService.updateAgents(parent_id, { versions: [create_new_version] });
  if (agentData.bridges.apikey_object_id) {
    await ConfigurationServices.updateApikeyCreds(create_new_version, agentData.bridges.apikey_object_id);
  }

  await addBulkUserEntries([
    {
      user_id,
      org_id,
      bridge_id: parent_id,
      version_id: create_new_version,
      type: "Version created",
      time: new Date()
    }
  ]);

  res.locals = {
    success: true,
    message: "version created successfully",
    version_id: create_new_version
  };
  req.statusCode = 200;
  return next();
};

const getVersion = async (req, res, next) => {
  const { version_id } = req.params;
  const result = await agentVersionDbService.getVersionWithTools(version_id);
  if (!result || !result.bridges) {
    res.locals = { success: false, message: "Agent version not found" };
    req.statusCode = 400;
    return next();
  }

  const agent = result.bridges;
  res.locals = {
    success: true,
    message: "agent get successfully",
    agent: agent
  };
  req.statusCode = 200;
  return next();
};

const publishVersion = async (req, res, next) => {
  const { version_id } = req.params;
  const org_id = req.profile.org.id;
  const user_id = req.profile.user.id;

  await agentVersionDbService.publish(org_id, version_id, user_id);

  res.locals = {
    success: true,
    message: "version published successfully",
    version_id: version_id
  };
  req.statusCode = 200;
  return next();
};

const removeVersion = async (req, res, next) => {
  const { version_id } = req.params;
  const org_id = req.profile.org.id;

  const result = await agentVersionDbService.deleteAgentVersion(org_id, version_id);
  res.locals = result;
  req.statusCode = 200;
  return next();
};

const bulkPublishVersion = async (req, res, next) => {
  const { version_ids } = req.body;
  const org_id = req.profile.org.id;
  const user_id = req.profile.user.id;

  // Validation handled by middleware

  const results = await Promise.all(
    version_ids.map(async (vid) => {
      try {
        await agentVersionDbService.publish(org_id, vid, user_id);
        return { status: "success", version_id: vid };
      } catch (error) {
        return { status: "failed", version_id: vid, error: error.message };
      }
    })
  );

  const published = results.filter((r) => r.status === "success").map((r) => r.version_id);
  const failed = results.filter((r) => r.status === "failed");

  res.locals = {
    success: failed.length === 0,
    message: "Bulk publish completed",
    published_version_ids: published,
    failed: failed
  };
  req.statusCode = 200;
  return next();
};

const discardVersion = async (req, res, next) => {
  const { version_id } = req.params;
  const { bridge_id } = req.body;
  const org_id = req.profile.org.id;

  // Verify version exists
  const versionDataResult = await agentVersionDbService.getVersionWithTools(version_id);
  if (!versionDataResult || !versionDataResult.bridges) {
    res.locals = { success: false, message: "Version not found" };
    req.statusCode = 400;
    return next();
  }

  // Fetch bridge/agent data using bridge_id
  const bridgeDataResult = await ConfigurationServices.getAgentsWithoutTools(bridge_id, org_id);
  if (!bridgeDataResult || !bridgeDataResult.bridges) {
    res.locals = { success: false, message: "Bridge not found" };
    req.statusCode = 400;
    return next();
  }

  const agentData = { ...bridgeDataResult.bridges };
  const keysToRemove = ["name", "slugName", "bridgeType", "_id", "versions", "apiCalls", "bridge_status"];
  keysToRemove.forEach((key) => delete agentData[key]);

  agentData.is_drafted = false;
  await agentVersionDbService.updateAgents(null, agentData, version_id);

  res.locals = {
    success: true,
    message: "version changes discarded successfully",
    version_id: version_id
  };
  req.statusCode = 200;
  return next();
};

const suggestModel = async (req, res, next) => {
  const { version_id } = req.params;
  const folder_id = req.profile.user.folder_id;

  const versionDataResult = await agentVersionDbService.getVersionWithTools(version_id);
  const versionData = versionDataResult?.bridges;

  if (!versionData) {
    res.locals = { success: false, message: "Version not found", data: { model: null, error: "Version not found" } };
    req.statusCode = 400;
    return next();
  }

  let available_services = versionData.apikey_object_id ? Object.keys(versionData.apikey_object_id) : [];

  if (folder_id) {
    const folderData = await folderDbService.getFolderData(folder_id);
    if (folderData && folderData.apikey_object_id) {
      available_services = Object.keys(folderData.apikey_object_id);
    }
  }

  if (!available_services || available_services.length === 0) {
    res.locals = {
      success: false,
      message: "Please select api key for proceeding further",
      data: { model: null, error: "Please select api key for proceeding further" }
    };
    req.statusCode = 400;
    return next();
  }

  const llmProviders = [];

  for (const service in modelConfigDocument) {
    if (available_services.includes(service)) {
      for (const model in modelConfigDocument[service]) {
        llmProviders.push({ provider: service, model });
      }
    }
  }

  if (llmProviders.length === 0) {
    res.locals = {
      success: false,
      message: "No models available for the selected services",
      data: { model: null, error: "No models available for the selected services" }
    };
    req.statusCode = 400;
    return next();
  }

  const prompt = versionData.configuration?.prompt;
  const tool_calls = Object.values(versionData.apiCalls || {}).map((call) => ({ [call.title]: call.description }));

  const systemContent = JSON.stringify({
    agent_system_prompt: prompt,
    agent_tools: tool_calls
  });

  const result = await selectBestModel(systemContent, llmProviders);

  res.locals = {
    success: true,
    message: "suggestion fetched successfully",
    data: result
  };
  req.statusCode = 200;
  return next();
};

const getConnectedAgents = async (req, res, next) => {
  const { version_id } = req.params; // Changed from 'id' to 'version_id'
  const { type } = req.query;
  const org_id = req.profile.org.id;

  const result = await agentVersionDbService.getAllConnectedAgents(version_id, org_id, type);
  res.locals = { success: true, data: result };
  req.statusCode = 200;
  return next();
};

export default {
  createVersion,
  getVersion,
  publishVersion,
  removeVersion,
  bulkPublishVersion,
  discardVersion,
  suggestModel,
  getConnectedAgents
};
