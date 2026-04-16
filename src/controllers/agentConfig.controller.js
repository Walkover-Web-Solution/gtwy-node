import ConfigurationServices from "../db_services/configuration.service.js";
import folderDbService from "../db_services/folder.service.js";
import agentVersionDbService from "../db_services/agentVersion.service.js";
import { callAiMiddleware } from "../services/utils/aiCall.utils.js";
import { bridge_ids, new_agent_service } from "../configs/constant.js";
import Helper from "../services/utils/helper.utils.js";
import conversationDbService from "../db_services/conversation.service.js";
const { addBulkUserEntries } = conversationDbService;
import { purgeRelatedBridgeCaches } from "../services/utils/redis.utils.js";
import { ensureChatbotPreview } from "../services/utility.service.js";
import { modelConfigDocument } from "../services/utils/loadModelConfigs.js";
import { sendAgentCreatedWebhook } from "../services/utils/agentWebhook.utils.js";

const createAgentController = async (req, res, next) => {
  try {
    const agents = req.body;
    const purpose = agents.purpose;
    const agentType = agents.bridgeType || "api";
    const org_id = req.profile.org.id;
    const folder_id = req.folder_id || null;
    const folder_data = await folderDbService.getFolderData(folder_id);
    const user_id = req.profile.user.id;
    const all_agent = await ConfigurationServices.getAgentsByUserId(org_id); // Assuming this returns all agents for org

    let prompt =
      "Role: AI Bot\nObjective: Respond logically and clearly, maintaining a neutral, automated tone.\nGuidelines:\nIdentify the task or question first.\nProvide brief reasoning before the answer or action.\nKeep responses concise and contextually relevant.\nAvoid emotion, filler, or self-reference.\nUse examples or placeholders only when helpful.";
    let name = agents?.name || null;
    let slugName = agents?.slugName || null;
    const meta = req.body.meta || null;
    let service = "openai";
    let model = "gpt-5-nano";
    let type = "chat";

    // If no folder_data (Main User), use structured object format
    if (!folder_data) {
      prompt = {
        role: "AI Bot",
        goal: "Respond logically and clearly, maintaining a neutral, automated tone.",
        instruction:
          "Guidelines:\nIdentify the task or question first.\nProvide brief reasoning before the answer or action.\nKeep responses concise and contextually relevant.\nAvoid emotion, filler, or self-reference.\nUse examples or placeholders only when helpful."
      };
    }

    // Check if folder has custom prompt configuration
    if (folder_data?.config?.prompt) {
      const folderPromptConfig = folder_data.config.prompt;
      const useDefaultPrompt = folderPromptConfig.useDefaultPrompt !== false; // Default: true
      // ✅ CASE 1: Use structured default object when default is ON
      if (useDefaultPrompt) {
        prompt = {
          role: "AI Bot",
          goal: "Respond logically and clearly, maintaining a neutral, automated tone.",
          instruction:
            "Guidelines:\nIdentify the task or question first.\nProvide brief reasoning before the answer or action.\nKeep responses concise and contextually relevant.\nAvoid emotion, filler, or self-reference.\nUse examples or placeholders only when helpful."
        };
      }

      if (!useDefaultPrompt && folderPromptConfig.customPrompt) {
        // CASE 2: Use Custom Prompt - build variables from non-hidden embedFields
        const embedFields = Array.isArray(folderPromptConfig.embedFields) ? folderPromptConfig.embedFields : [];
        const variables = embedFields.reduce((acc, field) => {
          if (field.hidden === false) {
            acc[field.name] = field.value;
          }
          return acc;
        }, {});
        prompt = { ...variables };
      }
    }

    if (agents.templateId) {
      const template_id = agents.templateId;
      const template_data = await ConfigurationServices.gettemplateById(template_id);
      if (!template_data) {
        res.locals = { success: false, message: "Template not found" };
        req.statusCode = 404;
        return next();
      }
      // Only override if we don't have folder prompt config
      if (!folder_data?.config?.prompt) {
        prompt = template_data.prompt || prompt;
      }
    }

    const all_agent_name = all_agent.map((agent) => agent.name);

    let agent_data = {};

    if (purpose) {
      const environment = String(process.env.ENVIRONMENT || "").toUpperCase() === "PRODUCTION" ? "prod" : "test";
      const variables = {
        purpose: purpose,
        environment: environment,
        all_bridge_names: all_agent_name,
        token: req.headers.authorization,
        fields:
          folder_data && folder_data?.config?.prompt?.useDefaultPrompt === false
            ? folder_data?.config?.prompt?.embedFields
                ?.filter((field) => !field.hidden)
                ?.reduce((acc, field) => {
                  acc[field.name] = field.value || "";
                  return acc;
                }, {}) || { role: "", goal: "", instruction: "" }
            : { role: "", goal: "", instruction: "" }
      };
      const user = "Generate Agent Configuration according to the given user purpose.";
      const res_data = await callAiMiddleware(user, bridge_ids["create_bridge_using_ai"], variables);
      // Use AI data as-is
      if (typeof res_data === "object") {
        agent_data = res_data;
      }
    }

    const { name: uniqueName, slugName: uniqueSlugName } = await ConfigurationServices.getUniqueAgentNameAndSlug(org_id, name);
    slugName = uniqueSlugName || slugName;
    name = uniqueName || name;

    // Use AI configuration if purpose exists and valid, otherwise build manually
    let model_data;
    let finalSettings;
    if (purpose && agent_data?.configuration) {
      // Use AI configuration as-is
      // Define the fixed AI-created agent settings
      finalSettings = {
        maximum_iterations: 3,
        publicUsers: [],
        editAccess: [],
        response_format: { type: "default" },
        guardrails: agent_data.guardrails,
        fall_back: agent_data.fall_back
      };
      model_data = {
        type: type,
        is_rich_text: false,
        prompt: prompt,
        ...agent_data.configuration
      };
    } else {
      // Build configuration manually (original logic)
      model_data = {};

      // Get model configuration if available
      const serviceLower = service.toLowerCase();
      if (modelConfigDocument[serviceLower] && modelConfigDocument[serviceLower][model]) {
        const modelObj = modelConfigDocument[serviceLower][model];
        const configurations = modelObj.configuration || {};

        for (const key in configurations) {
          model_data[key] = key === "model" ? configurations[key].default : "default";
        }
      }

      model_data.type = type;
      model_data.is_rich_text = false;
      model_data.prompt = prompt;
    }

    if (folder_data) {
      const api_key_object_ids = folder_data.apikey_object_id || {};
      if (Object.keys(api_key_object_ids).length > 0) {
        service = Object.keys(api_key_object_ids)[0];
        if (new_agent_service[service]) {
          model_data.model = new_agent_service[service].model;
        }
      }
    }

    const agent_limit = agents.bridge_limit;
    const agent_usage = agents.bridge_usage;
    const agent_limit_reset_period = agents.bridge_limit_reset_period;
    const agent_limit_start_date = agents.bridge_limit_start_date;

    const useAiData = purpose && Object.keys(agent_data).length > 0;
    const aiVal = (aiField, fallback) => (useAiData ? (aiField ?? fallback) : fallback);
    const mergedConfiguration = { ...(useAiData ? agent_data?.configuration : {}), ...model_data };
    const fallbackSettings = agents?.settings || {};
    const baseSettings = (useAiData ? finalSettings : aiVal(agent_data?.settings, fallbackSettings)) || {};
    const fallbackStatelessConversation =
      agentType === "api" ? true : (agents?.settings?.stateless_conversation ?? agents?.stateless_conversation ?? false);
    const mergedSettings = {
      ...baseSettings,
      stateless_conversation: baseSettings?.stateless_conversation ?? fallbackStatelessConversation
    };
    const cleanAgentData = { ...(useAiData ? agent_data : {}) };
    delete cleanAgentData.guardrails;
    delete cleanAgentData.fall_back;
    const result = await ConfigurationServices.createAgent({
      ...cleanAgentData,
      configuration: mergedConfiguration,
      name: aiVal(agent_data?.name, name),
      slugName: slugName,
      service: aiVal(agent_data?.service, service),
      bridgeType: agentType,
      org_id: org_id,
      gpt_memory: aiVal(agent_data?.gpt_memory, true),
      folder_id: folder_id,
      user_id: user_id,
      settings: mergedSettings,
      bridge_limit: agent_limit,
      bridge_usage: agent_usage,
      bridge_limit_reset_period: agent_limit_reset_period,
      bridge_limit_start_date: agent_limit_start_date,
      bridge_status: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      meta: meta
    });

    const create_version = await agentVersionDbService.createAgentVersion(result.bridge);
    const update_fields = { versions: [create_version._id.toString()] };
    const updated_agent_result = await ConfigurationServices.updateAgent(result.bridge._id.toString(), update_fields);

    res.locals = {
      success: true,
      message: "Agent created successfully",
      agent: updated_agent_result.result
    };
    req.statusCode = 200;

    if (!folder_id) {
      sendAgentCreatedWebhook(updated_agent_result.result, org_id).catch((err) => {
        console.error("Webhook failed:", err);
      });
    }

    return next();
  } catch (e) {
    res.locals = { success: false, message: "Error in creating agent: " + e.message };
    req.statusCode = 400;
    return next();
  }
};

const updateAgentController = async (req, res, next) => {
  try {
    const { agent_id } = req.params;
    const body = req.body;
    const org_id = String(req.profile.org.id);
    const user_id = String(req.profile.user.id);

    const agentData = await ConfigurationServices.getAgentsWithTools(agent_id, org_id);
    if (!agentData.bridges) {
      res.locals = { success: false, message: "Agent not found" };
      req.statusCode = 404;
      return next();
    }

    const agent = agentData.bridges;
    const update_fields = {};
    const user_history = [];

    const simpleAgentFields = [
      "name",
      "slugName",
      "meta",
      "bridge_summary",
      "bridge_status",
      "bridge_usage",
      "bridge_limit",
      "bridgeType",
      "page_config",
      "connected_agent_details"
    ];

    for (const field of simpleAgentFields) {
      if (body[field] !== undefined) {
        update_fields[field] = body[field];
      }
    }

    if (body.bridge_limit_reset_period !== undefined) {
      update_fields.bridge_limit_reset_period = body.bridge_limit_reset_period;
      update_fields.bridge_limit_start_date = new Date();
    }

    if (body.settings !== undefined || body.stateless_conversation !== undefined) {
      const current_settings = agent.settings || {};
      const merged_settings = { ...current_settings };

      if (body.settings?.editAccess !== undefined) {
        merged_settings.editAccess = body.settings.editAccess;
        update_fields.editAccess = body.settings.editAccess;
      }

      if (body.settings?.publicUsers !== undefined) {
        merged_settings.publicUsers = body.settings.publicUsers;
        const currentPageConfig = agent.page_config || {};
        update_fields.page_config = { ...currentPageConfig, allowedUsers: body.settings.publicUsers };
      }

      if (body.settings?.stateless_conversation !== undefined) {
        merged_settings.stateless_conversation = body.settings.stateless_conversation;
      } else if (body.stateless_conversation !== undefined) {
        merged_settings.stateless_conversation = body.stateless_conversation;
      }

      update_fields.settings = merged_settings;
    }

    update_fields.updatedAt = new Date();
    await ConfigurationServices.updateAgent(agent_id, update_fields);

    const historyBase = {
      user_id,
      org_id,
      bridge_id: agent_id,
      version_id: null,
      time: new Date()
    };

    const agentVersions = Array.isArray(agent.versions) ? agent.versions : [];
    for (const key of Object.keys(body)) {
      for (const version of agentVersions) {
        user_history.push({
          ...historyBase,
          version_id: String(version),
          type: key === "settings" ? "editAccess" : key
        });
      }
    }

    if (user_history.length > 0) {
      await addBulkUserEntries(user_history);
    }

    const updatedAgent = await ConfigurationServices.getAgentsWithTools(agent_id, org_id);

    try {
      await purgeRelatedBridgeCaches(agent_id, body.bridge_usage !== undefined ? body.bridge_usage : -1);
    } catch (e) {
      console.error(`Failed clearing agent related cache on update: ${e}`);
    }

    const response = await Helper.responseMiddlewareForBridge(
      updatedAgent.bridges.service,
      {
        success: true,
        message: "Agent Updated successfully",
        agent: updatedAgent.bridges
      },
      true
    );

    res.locals = response;
    req.statusCode = 200;
    return next();
  } catch (e) {
    res.locals = { success: false, message: e.message };
    req.statusCode = 400;
    return next();
  }
};

const getAgentsAndVersionsByModelController = async (req, res, next) => {
  try {
    const { modelName } = req.params;
    const result = await ConfigurationServices.getAgentsAndVersionsByModel(modelName);
    res.locals = {
      success: true,
      message: "Fetched models and agents they are used in successfully.",
      [modelName]: result
    };
    req.statusCode = 200;
    return next();
  } catch (e) {
    res.locals = { success: false, message: e.message };
    req.statusCode = 500;
    return next();
  }
};

const cloneAgentController = async (req, res, next) => {
  try {
    const { agent_id, to_shift_org_id } = req.body;
    const result = await ConfigurationServices.cloneAgentToOrg(agent_id, to_shift_org_id);
    res.locals = result;
    req.statusCode = result.success ? 200 : 400;
    return next();
  } catch (e) {
    res.locals = { success: false, message: e.message };
    req.statusCode = 500;
    return next();
  }
};

const getAgentController = async (req, res, next) => {
  try {
    const { agent_id } = req.params;
    const org_id = req.profile.org.id;

    const agent = await ConfigurationServices.getAgentsWithTools(agent_id, org_id);

    if (!agent.bridges) {
      res.locals = { success: false, message: "Agent not found" };
      req.statusCode = 404;
      return next();
    }

    const prompt = agent.bridges.configuration?.prompt;
    let variables = [];
    if (prompt) {
      variables = Helper.findVariablesInString(prompt);
    }

    const variables_path = agent.bridges.variables_path || {};
    const path_variables = [];
    for (const key in variables_path) {
      const val = variables_path[key];
      if (typeof val === "object") {
        path_variables.push(...Object.keys(val));
      } else {
        path_variables.push(val);
      }
    }

    const all_variables = [...variables, ...path_variables];
    agent.bridges.all_varaibles = all_variables;

    // Get access role from middleware (second layer check)
    const access_role = req.access_role || req.role_name || null;

    // Simplified response middleware
    res.locals = {
      success: true,
      message: "agent get successfully",
      agent: agent.bridges,
      access: access_role
    };
    req.statusCode = 200;
    return next();
  } catch (e) {
    res.locals = { success: false, message: e.message };
    req.statusCode = 400;
    return next();
  }
};

const getAllAgentController = async (req, res, next) => {
  try {
    const org_id = req.profile.org.id;
    const folder_id = req.folder_id || null;
    const user_id = req.profile.user.id || null;
    const isEmbedUser = req.embed;

    const agents = await ConfigurationServices.getAllAgentsInOrg(org_id, folder_id, user_id, isEmbedUser);
    if (!isEmbedUser && !folder_id) {
      await ensureChatbotPreview(org_id, user_id, agents);
    }

    // Get role_name from middleware (first layer check)
    const role_name = req.role_name || null;
    // Generate tokens
    let viasocket_embed_user_id = org_id.toString(); // Using org_id as the base user identifier
    if (user_id && isEmbedUser && folder_id) {
      viasocket_embed_user_id = viasocket_embed_user_id + "_" + folder_id + "_" + user_id;
    }
    const embed_token = Helper.generate_token(
      {
        org_id: process.env.ORG_ID,
        project_id: process.env.PROJECT_ID,
        user_id: viasocket_embed_user_id
      },
      process.env.ACCESS_KEY
    );

    const alerting_embed_token = Helper.generate_token(
      {
        org_id: process.env.ORG_ID,
        project_id: process.env.ALERTING_PROJECT_ID,
        user_id: viasocket_embed_user_id
      },
      process.env.ACCESS_KEY
    );

    const trigger_embed_token = Helper.generate_token(
      {
        org_id: process.env.ORG_ID,
        project_id: process.env.TRIGGER_PROJECT_ID,
        user_id: viasocket_embed_user_id
      },
      process.env.ACCESS_KEY
    );

    const history_page_chatbot_token = Helper.generate_token(
      {
        org_id: "11202",
        chatbot_id: "67286d4083e482fd5b466b69",
        user_id: org_id
      },
      process.env.CHATBOT_ACCESS_KEY
    );

    const doctstar_embed_token = Helper.generate_token(
      {
        org_id: process.env.DOCSTAR_ORG_ID,
        collection_id: process.env.DOCSTAR_COLLECTION_ID,
        user_id: org_id,
        read_only: role_name === "viewer"
      },
      process.env.DOCSTAR_ACCESS_KEY
    );

    res.locals = {
      success: true,
      message: "Get all agents successfully",
      agent: agents.filter((agent) => agent.slugName !== "chatbot_preview"),
      org_id: org_id,
      access: role_name,
      embed_token: embed_token,
      alerting_embed_token: alerting_embed_token,
      trigger_embed_token: trigger_embed_token,
      history_page_chatbot_token: history_page_chatbot_token,
      doctstar_embed_token: doctstar_embed_token
    };
    req.statusCode = 200;
    return next();
  } catch (e) {
    res.locals = { success: false, message: e.message };
    req.statusCode = 500;
    return next();
  }
};

const deleteAgentController = async (req, res, next) => {
  const { agent_id } = req.params;
  const org_id = req.profile.org.id;
  const { restore = false } = req.body;
  try {
    let result;
    if (restore) {
      // Restore the agent
      result = await ConfigurationServices.restoreAgent(agent_id, org_id);
      // Log restore operation for audit purposes
      if (result.success) {
        console.log(`Agent restore completed for agent ${agent_id} and ${result.restoredVersionsCount || 0} versions for org ${org_id}`);
      }
    } else {
      // Soft delete the agent
      result = await ConfigurationServices.deleteAgent(agent_id, org_id);
      // Log soft delete operation for audit purposes
      if (result.success) {
        console.log(`Soft delete initiated for agent ${agent_id} and ${result.deletedVersionsCount || 0} versions for org ${org_id}`);
      }
    }

    res.locals = result;
    req.statusCode = result?.success ? 200 : 400;
    return next();
  } catch (error) {
    console.error(`${restore ? "restore" : "delete"} agent error => `, error.message);
    throw error;
  }
};

export {
  createAgentController,
  getAgentController,
  getAllAgentController,
  updateAgentController,
  getAgentsAndVersionsByModelController,
  cloneAgentController,
  deleteAgentController
};
