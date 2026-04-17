import agentVersionDbService from "../db_services/agentVersion.service.js";
import ConfigurationServices from "../db_services/configuration.service.js";
import folderDbService from "../db_services/folder.service.js";
import { modelConfigDocument } from "../services/utils/loadModelConfigs.js";
import { selectBestModel } from "../services/utils/notDiamond.utils.js";
import { ObjectId } from "mongodb";
import conversationDbService from "../db_services/conversation.service.js";
import { getDefaultValuesController } from "../services/utils/getDefaultValue.js";
import { purgeRelatedBridgeCaches } from "../services/utils/redis.utils.js";
import { validateJsonSchemaConfiguration } from "../services/utils/common.utils.js";
import { convertPromptToString } from "../utils/promptWrapper.utils.js";

const { storeSystemPrompt, addBulkUserEntries } = conversationDbService;

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

  res.locals = {
    success: true,
    message: "version created successfully",
    version_id: create_new_version
  };
  req.statusCode = 200;
  return next();
};

const updateVersionController = async (req, res, next) => {
  try {
    const { version_id } = req.params;
    const body = req.body;
    const org_id = String(req.profile.org.id);
    const user_id = String(req.profile.user.id);

    const versionData = await ConfigurationServices.getAgentsWithTools(null, org_id, version_id);
    if (!versionData.bridges) {
      res.locals = { success: false, message: "Version not found" };
      req.statusCode = 404;
      return next();
    }

    const version = versionData.bridges;
    const parent_id = version.parent_id;
    const current_configuration = version.configuration || {};
    let current_variables_path = version.variables_path || {};
    let function_ids = version.function_ids || [];

    const update_fields = {};
    const user_history = [];

    let new_configuration = body.configuration;
    const service = body.service;

    if (new_configuration) {
      const { isValid, errorMessage } = validateJsonSchemaConfiguration(new_configuration);
      if (!isValid) {
        res.locals = { success: false, message: errorMessage };
        req.statusCode = 400;
        return next();
      }
    }

    if (body.apikey_object_id) {
      const apikey_object_id = body.apikey_object_id;
      await ConfigurationServices.getApikeyCreds(org_id, apikey_object_id);
      update_fields.apikey_object_id = apikey_object_id;
      await ConfigurationServices.updateApikeyCreds(version_id, apikey_object_id);
    }

    if (new_configuration && new_configuration.prompt) {
      const promptString = convertPromptToString(new_configuration.prompt);
      const prompt_result = await storeSystemPrompt(promptString, org_id, parent_id || version_id);
      if (prompt_result && prompt_result.id) {
        new_configuration.system_prompt_version_id = prompt_result.id;
      }
    }

    if (new_configuration && new_configuration.type && new_configuration.type !== "fine-tune") {
      new_configuration.fine_tune_model = { current_model: null };
    }

    const simpleVersionFields = [
      "user_reference",
      "gpt_memory",
      "gpt_memory_context",
      "doc_ids",
      "IsstarterQuestionEnable",
      "auto_model_select",
      "cache_on",
      "pre_tools",
      "web_search_filters",
      "gtwy_web_search_filters",
      "connected_agent_flow"
    ];

    for (const field of simpleVersionFields) {
      if (body[field] !== undefined) {
        update_fields[field] = body[field];
      }
    }

    if (body.settings !== undefined) {
      const current_settings = version.settings || {};
      update_fields.settings = { ...current_settings, ...body.settings };
    }

    if (service) {
      update_fields.service = service;
      if (new_configuration && new_configuration.model) {
        const configuration = await getDefaultValuesController(service, new_configuration.model, current_configuration, new_configuration.type);
        new_configuration = { ...configuration, type: new_configuration.type || "chat" };
      }
    }

    if (new_configuration) {
      if (new_configuration.model && !service) {
        const current_service = version.service;
        const configuration = await getDefaultValuesController(
          current_service,
          new_configuration.model,
          current_configuration,
          new_configuration.type
        );
        new_configuration = { ...new_configuration, ...configuration, type: new_configuration.type || "chat" };
      }
      update_fields.configuration = { ...current_configuration, ...new_configuration };
    }

    if (body.variables_path) {
      const updated_variables_path = { ...current_variables_path, ...body.variables_path };
      for (const key in updated_variables_path) {
        if (Array.isArray(updated_variables_path[key])) {
          updated_variables_path[key] = {};
        }
      }
      update_fields.variables_path = updated_variables_path;
      current_variables_path = updated_variables_path;
    }

    if (body.built_in_tools_data) {
      const { built_in_tools, built_in_tools_operation } = body.built_in_tools_data;
      if (built_in_tools) {
        const op = built_in_tools_operation === "1" ? 1 : 0;
        await ConfigurationServices.updateBuiltInTools(version_id, built_in_tools, op);
      }
    }

    if (body.agents) {
      const { connected_agents, agent_status } = body.agents;
      if (connected_agents) {
        const op = agent_status === "1" ? 1 : 0;
        if (op === 0) {
          for (const agent_info of Object.values(connected_agents)) {
            const key = agent_info.bridge_id?.toString() ?? agent_info.bridge_id;
            if (key && current_variables_path[key]) {
              delete current_variables_path[key];
              update_fields.variables_path = current_variables_path;
            }
          }
        }
        await ConfigurationServices.updateAgents(version_id, connected_agents, op);
      }
    }

    if (Array.isArray(body.function_ids)) {
      update_fields.function_ids = body.function_ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
      function_ids = [...body.function_ids];
    }

    if (body.functionData) {
      const { function_id, function_operation, script_id } = body.functionData;
      if (function_id) {
        const op = function_operation === "1" ? 1 : 0;

        if (op === 1) {
          if (!function_ids.includes(function_id)) {
            function_ids.push(function_id);
            update_fields.function_ids = function_ids.map((fid) => new ObjectId(fid));
            await ConfigurationServices.updateAgentIdsInApiCalls(function_id, version_id, 1);
          }
        } else {
          if (script_id && current_variables_path[script_id]) {
            delete current_variables_path[script_id];
            update_fields.variables_path = current_variables_path;
          }
          if (function_ids.includes(function_id)) {
            function_ids = function_ids.filter((fid) => fid.toString() !== function_id);
            update_fields.function_ids = function_ids.map((fid) => new ObjectId(fid));
            await ConfigurationServices.updateAgentIdsInApiCalls(function_id, version_id, 0);
          }
        }
      }
    }

    if (body.version_description === undefined) {
      update_fields.is_drafted = true;
    } else {
      update_fields.version_description = body.version_description;
    }

    for (const key in body) {
      const value = body[key];
      const history_entry = {
        user_id,
        org_id,
        bridge_id: parent_id || "",
        version_id,
        time: new Date()
      };

      if (key === "configuration") {
        for (const config_key in value) {
          user_history.push({ ...history_entry, type: config_key });
        }
      } else {
        user_history.push({ ...history_entry, type: key });
      }
    }

    update_fields.updatedAt = new Date();
    await ConfigurationServices.updateAgent(parent_id || version_id, update_fields, version_id);

    if (parent_id) {
      await ConfigurationServices.updateAgent(parent_id, { updatedAt: new Date() }, null);
    }

    const updatedAgent = await ConfigurationServices.getAgentsWithTools(parent_id || version_id, org_id, version_id);

    if (user_history.length > 0) {
      await addBulkUserEntries(user_history);
    }

    try {
      await purgeRelatedBridgeCaches(parent_id || version_id, -1);
    } catch (e) {
      console.error(`Failed clearing version related cache on update: ${e}`);
    }

    if (service) {
      updatedAgent.bridges.service = service;
    }

    res.locals = {
      success: true,
      message: "Version Updated successfully",
      agent: updatedAgent.bridges
    };
    req.statusCode = 200;
    return next();
  } catch (e) {
    res.locals = { success: false, message: e.message };
    req.statusCode = 400;
    return next();
  }
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
  updateVersionController,
  publishVersion,
  removeVersion,
  bulkPublishVersion,
  discardVersion,
  suggestModel,
  getConnectedAgents
};
