import templateService from "../db_services/template.service.js";
import ConfigurationServices from "../db_services/configuration.service.js";
import agentVersionDbService from "../db_services/agentVersion.service.js";
import apiCallModel from "../mongoModel/ApiCall.model.js";
import { ObjectId } from "mongodb";
import { cloneFunctionsForAgent } from "../utils/agentConfig.utils.js";
import { copyResourceToOrgUtil } from "../utils/rag.utils.js";
import { callAiMiddleware } from "../services/utils/aiCall.utils.js";
import { bridge_ids } from "../configs/constant.js";

const allTemplates = async (req, res, next) => {
  const result = await templateService.getAll();
  res.locals = {
    success: true,
    result
  };
  req.statusCode = 200;
  return next();
};

/**
 * Filter bridge/agent data to include only specific keys
 */
const FILTER_BRIDGE_EXCLUDE_KEYS = new Set([
  "api_key_object",
  "apikey",
  "user_id",
  "total_tokens",
  "prompt_total_tokens",
  "ai_updates",
  "bridge_usage",
  "bridge_limit",
  "bridge_limit_reset_period",
  "bridge_limit_start_date",
  "last_used",
  "responseIds",
  "__v",
  "createdAt",
  "updatedAt",
  "created_at",
  "deletedAt",
  "parent_id",
  "published_version_id",
  "versions",
  "is_drafted",
  "response_format"
]);

export function filterBridge(data) {
  const pick = (obj) => {
    if (!obj) return {};
    return Object.fromEntries(Object.entries(obj).filter(([k]) => !FILTER_BRIDGE_EXCLUDE_KEYS.has(k)));
  };

  const toArray = (maybeObjOrArr) =>
    Array.isArray(maybeObjOrArr) ? maybeObjOrArr : maybeObjOrArr && typeof maybeObjOrArr === "object" ? Object.values(maybeObjOrArr) : [];

  return {
    bridge: pick(data || {}),
    child_agents: toArray(data?.child_agents).map(pick)
  };
}

/**
 * Create a template from an existing bridge/agent
 */
const createTemplate = async (req, res, next) => {
  const { agent_id } = req.params;
  const { templateName } = req.body;

  if (!agent_id) {
    throw new Error("agent_id is required");
  }

  if (!templateName) {
    throw new Error("templateName is required");
  }

  // Get the bridge data
  const bridgeData = await ConfigurationServices.getAgents(agent_id);
  if (!bridgeData.success || !bridgeData.bridges) {
    throw new Error("Bridge not found");
  }

  let bridge = bridgeData.bridges;

  // Get function data for each tool in connected_tools
  const functionData = [];
  if (bridge.connected_tools && bridge.connected_tools.length > 0) {
    for (const tool of bridge.connected_tools) {
      if (tool.type === "tools") {
        const id = tool.id.buffer ? new ObjectId(Buffer.from(tool.id.buffer)) : new ObjectId(tool.id);
        const functionDetails = await apiCallModel.findOne({ _id: id }, { function_name: 1 });
        if (functionDetails) {
          functionData.push(functionDetails);
        }
      }
    }
  }

  // Add function data to bridge
  bridge.function_data = functionData;
  bridge = filterBridge(bridge).bridge;
  bridge = Object.fromEntries(Object.entries(bridge).filter(([, v]) => v !== null));

  const buildConnectedAgents = async (connected_tools, ancestorIds = new Set()) => {
    const result = {};
    for (const tool of connected_tools) {
      if (tool.type !== "agent") continue;

      const agentBridgeId = tool.id?.toString() ?? tool.id;
      if (!agentBridgeId) continue;

      if (ancestorIds.has(agentBridgeId)) {
        result[agentBridgeId] = {
          bridge_id: agentBridgeId,
          ...(tool.thread_id !== undefined && { thread_id: tool.thread_id }),
          ...(tool.version_id !== undefined && { version_id: tool.version_id }),
          bridge_details: {}
        };
        continue;
      }

      const childBridgeData = await ConfigurationServices.getAgents(agentBridgeId);
      if (!childBridgeData.success || !childBridgeData.bridges) continue;

      let childBridge = childBridgeData.bridges;

      const childFunctionData = [];
      if (childBridge.connected_tools && childBridge.connected_tools.length > 0) {
        for (const childTool of childBridge.connected_tools) {
          if (childTool.type === "tools") {
            const id = childTool.id.buffer ? new ObjectId(Buffer.from(childTool.id.buffer)) : new ObjectId(childTool.id);
            const functionDetails = await apiCallModel.findOne({ _id: id }, { function_name: 1 });
            if (functionDetails) childFunctionData.push(functionDetails);
          }
        }
      }
      childBridge.function_data = childFunctionData;

      const filteredBridge = Object.fromEntries(
        Object.entries(filterBridge(childBridge)?.bridge).filter(([k, v]) => v !== null && k !== "connected_tools")
      );

      if (childBridge.connected_tools && childBridge.connected_tools.some((t) => t.type === "agent")) {
        const childAncestors = new Set([...ancestorIds, agentBridgeId]);
        filteredBridge.child_agents = await buildConnectedAgents(childBridge.connected_tools, childAncestors);
      }

      result[agentBridgeId] = {
        bridge_id: agentBridgeId,
        ...(tool.thread_id !== undefined && { thread_id: tool.thread_id }),
        ...(tool.version_id !== undefined && { version_id: tool.version_id }),
        bridge_details: filteredBridge
      };
    }
    return result;
  };

  if (bridge.connected_tools && bridge.connected_tools.some((t) => t.type === "agent")) {
    bridge.child_agents = await buildConnectedAgents(bridge.connected_tools, new Set([agent_id]));
  }
  const user = "Validate the template";
  const email = req.profile?.user?.email;

  // Only validate via AI middleware for non-embed users with email
  let isValid = { status: true };
  if (!req.IsEmbedUser && email) {
    isValid = await callAiMiddleware(user, bridge_ids["template_validator"], { template: bridge, templateName, email });
  }

  // Save the template
  if (isValid?.status) {
    const template = await templateService.saveTemplate(bridge, templateName);
    res.locals = {
      success: true,
      result: template
    };
    req.statusCode = 200;
    return next();
  } else {
    res.locals = {
      success: false,
      message: "Failed to convert agent to template."
    };
    req.statusCode = 400;
    return next();
  }
};

const createAgentFromTemplateController = async (req, res, next) => {
  try {
    const { template_id } = req.params;
    const org_id = req.profile.org.id;
    const user_id = req.profile.user.id;
    const folder_id = req.folder_id || null;

    const agentType = req.body.bridgeType || "api";
    const meta = req.body.meta || null;

    const template_data = await ConfigurationServices.gettemplateById(template_id);
    if (!template_data) {
      res.locals = { success: false, message: "Template not found" };
      req.statusCode = 404;
      return next();
    }

    const template_content = JSON.parse(template_data.template);

    let name = template_data.templateName;
    let service = template_content?.service;
    let type = template_content?.configuration?.type;
    let prompt = template_content?.configuration?.prompt;

    const { name: uniqueName, slugName } = await ConfigurationServices.getUniqueAgentNameAndSlug(org_id, name);
    name = uniqueName;

    let model_data = { ...(template_content?.configuration || {}) };
    model_data.type = model_data.type || type;
    if (model_data.is_rich_text === undefined) model_data.is_rich_text = false;
    model_data.prompt = model_data.prompt || prompt;

    const fall_back = template_content?.settings?.fall_back || { is_enable: true, service: "openai", model: "gpt-5.1" };

    // Exclude _id and other fields that should not be copied from template
    // eslint-disable-next-line no-unused-vars
    const { _id, ...templateDataWithoutId } = template_content;

    const result = await ConfigurationServices.createAgent({
      ...templateDataWithoutId,
      configuration: model_data,
      name,
      slugName,
      service,
      bridgeType: ["api", "chatbot"].includes(template_content?.bridgeType) ? template_content.bridgeType : agentType,
      org_id,
      gpt_memory: true,
      user_id,
      folder_id,
      fall_back,
      bridge_status: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      meta
    });

    const create_version = await agentVersionDbService.createAgentVersion(result.bridge);
    await ConfigurationServices.updateAgent(result.bridge._id.toString(), {
      versions: [create_version._id.toString()],
      published_version_id: create_version._id.toString()
    });

    // --- Collect all unique function IDs and doc resource pairs across root + all children ---
    const collectAllResources = (content, allFunctionIds, allDocPairs) => {
      if (!content) return;
      if (Array.isArray(content.connected_tools)) {
        for (const tool of content.connected_tools) {
          if (tool.type === "tools") {
            allFunctionIds.add(tool.id);
          } else if (tool.type === "pre_tool" && tool.pre_tool_type === "custom_function" && tool.variable_path?.function_id) {
            allFunctionIds.add(tool.variable_path.function_id);
          } else if (tool.type === "docs" && tool.id) {
            // Assuming docs have collection_id:resource_id format in id
            allDocPairs.set(tool.id, tool);
          }
        }
      }
      if (content.child_agents) {
        for (const child_agent of Object.values(content.child_agents)) {
          collectAllResources(child_agent?.bridge_details, allFunctionIds, allDocPairs);
        }
      }
    };

    const allFunctionIds = new Set();
    const allDocPairs = new Map();
    collectAllResources(template_content, allFunctionIds, allDocPairs);

    // Clone all unique functions once → functionIdMap (old → new)
    const functionIdMap = new Map();
    if (allFunctionIds.size > 0) {
      const uniqueIds = [...allFunctionIds];
      const isEmbedUser = req.IsEmbedUser || false;
      const clonedIds = await cloneFunctionsForAgent(uniqueIds, org_id, result.bridge._id.toString(), folder_id, user_id, isEmbedUser);
      uniqueIds.forEach((oldId, i) => {
        if (clonedIds[i]) functionIdMap.set(oldId, clonedIds[i]);
      });
    }

    // Copy all unique doc resources in parallel → docIdMap (collection_id:resource_id → new entry)
    const docIdMap = new Map();
    const docEntries = [...allDocPairs.entries()];
    if (docEntries.length > 0) {
      const isEmbedUser = req.IsEmbedUser || false;
      const docResults = await Promise.allSettled(
        docEntries.map(([key, doc]) =>
          copyResourceToOrgUtil({
            collection_id: doc.collection_id,
            resource_id: doc.resource_id,
            org_id,
            folder_id,
            user_id,
            isEmbedUser,
            extra: { ...(doc.name && { name: doc.name }), ...(doc.description && { description: doc.description }) }
          }).then((copied) => ({ key, copied }))
        )
      );
      docResults.forEach((result) => {
        if (result.status === "fulfilled") docIdMap.set(result.value.key, result.value.copied);
        else console.error("Error copying doc resource:", result.reason?.message);
      });
    }

    // --- Helpers that use maps instead of cloning each time ---
    const resolveConnectedTools = (connected_tools) => {
      if (!Array.isArray(connected_tools) || connected_tools.length === 0) return null;
      return connected_tools.map((tool) => {
        const clonedTool = { ...tool };
        if (tool.type === "tools") {
          const newFid = functionIdMap.get(tool.id);
          if (newFid) clonedTool.id = newFid;
        } else if (tool.type === "pre_tool" && tool.variable_path?.function_id) {
          const newFid = functionIdMap.get(tool.variable_path.function_id);
          if (newFid) clonedTool.variable_path.function_id = newFid;
        } else if (tool.type === "docs") {
          const newDoc = docIdMap.get(tool.id);
          if (newDoc) clonedTool.id = newDoc.resource_id; // Update with new resource_id
        }
        return clonedTool;
      });
    };

    const pickDefined = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

    const resolveApiCalls = (apiCalls) => {
      if (!apiCalls || typeof apiCalls !== "object" || Object.keys(apiCalls).length === 0) return null;
      const remapped = {};
      for (const [oldKey, fn] of Object.entries(apiCalls)) {
        const newKey = functionIdMap.get(oldKey) || oldKey;
        remapped[newKey] = { ...fn, _id: newKey, version_ids: [] };
      }
      return remapped;
    };

    const resolveToolChoice = (toolChoice) => {
      // Handle custom format {"mode":"custom","value":"tool_id"}
      if (toolChoice && typeof toolChoice === "object" && toolChoice.mode === "custom" && toolChoice.value) {
        const newToolId = functionIdMap.get(toolChoice.value);
        if (newToolId) {
          return newToolId;
        }
        return "default";
      }

      if (!toolChoice || toolChoice === "default" || toolChoice === "auto" || toolChoice === "none") {
        return toolChoice;
      }
      if (typeof toolChoice === "object") {
        // Extract tool_id from various formats and return as simple string
        if (toolChoice.tool_id) {
          const newToolId = functionIdMap.get(toolChoice.tool_id);
          if (newToolId) return newToolId;
          return toolChoice.tool_id;
        }
        if (toolChoice.function?.tool_id) {
          const newToolId = functionIdMap.get(toolChoice.function.tool_id);
          if (newToolId) return newToolId;
          return toolChoice.function.tool_id;
        }
        if (Array.isArray(toolChoice.functions) && toolChoice.functions.length > 0) {
          // For array format, return the first mapped tool_id
          const firstFn = toolChoice.functions[0];
          if (firstFn.tool_id) {
            const newToolId = functionIdMap.get(firstFn.tool_id);
            if (newToolId) return newToolId;
            return firstFn.tool_id;
          }
        }
      }
      return toolChoice;
    };

    // Apply to root agent — batch all updates into single DB calls
    const parent_updates = {};
    const parent_connected_tools = resolveConnectedTools(template_content?.connected_tools);
    if (parent_connected_tools) parent_updates.connected_tools = parent_connected_tools;
    const parent_api_calls = resolveApiCalls(template_content?.apiCalls);
    if (parent_api_calls) parent_updates.apiCalls = parent_api_calls;
    const parent_tool_choice = resolveToolChoice(model_data.tool_choice);
    if (parent_tool_choice !== undefined) parent_updates.configuration = { ...model_data, tool_choice: parent_tool_choice };
    if (Object.keys(parent_updates).length > 0) {
      await ConfigurationServices.updateAgent(result.bridge._id.toString(), parent_updates);
      await ConfigurationServices.updateAgent(null, parent_updates, create_version._id.toString());
    }

    const createdAgentsMap = new Map();
    const rootBridgeId = template_content._id?.toString() ?? template_content._id;
    if (rootBridgeId) {
      createdAgentsMap.set(rootBridgeId, result.bridge._id.toString());
    }

    const createChildAgentsRecursively = async (
      child_agents_map,
      parent_bridge_id,
      parent_version_id,
      ancestorIds = new Set(),
      isEmbedUser = false
    ) => {
      if (!child_agents_map || Object.keys(child_agents_map).length === 0) return;
      const connected_tools = [];

      for (const [agent_id, child_agent] of Object.entries(child_agents_map)) {
        const templateBridgeId = child_agent?.bridge_id?.toString() ?? child_agent?.bridge_id;
        const cycleKey = templateBridgeId || agent_id;

        if (ancestorIds.has(cycleKey)) {
          const existingBridgeId = createdAgentsMap.get(cycleKey);
          if (existingBridgeId) {
            connected_tools.push({
              type: "agent",
              id: existingBridgeId,
              ...pickDefined(child_agent, ["thread_id", "version_id"])
            });
          }
          continue;
        }

        // Same agent referenced by multiple parents — reuse already-created bridge
        if (createdAgentsMap.has(cycleKey)) {
          const reusedId = createdAgentsMap.get(cycleKey);
          connected_tools.push({
            type: "agent",
            id: reusedId,
            ...pickDefined(child_agent, ["thread_id", "version_id"])
          });
          continue;
        }

        const child_details = child_agent?.bridge_details;
        if (!child_details || Object.keys(child_details).length === 0) continue;

        const actualAgentName = child_details.name || agent_id;
        const childNameSlug = await ConfigurationServices.getUniqueAgentNameAndSlug(org_id, actualAgentName);
        const child_model_data = { ...(child_details.configuration || {}) };
        child_model_data.type = child_model_data.type || type;
        if (child_model_data.is_rich_text === undefined) child_model_data.is_rich_text = false;
        child_model_data.prompt = child_model_data.prompt || prompt;
        child_model_data.tool_choice = "default";

        let child_service = child_details.service || service;

        // Exclude _id and other fields that should not be copied from template
        // eslint-disable-next-line no-unused-vars
        const { _id, ...childDataWithoutId } = child_details;

        const child_result = await ConfigurationServices.createAgent({
          ...childDataWithoutId,
          configuration: child_model_data,
          name: childNameSlug.name,
          slugName: childNameSlug.slugName,
          service: child_service,
          bridgeType: isEmbedUser ? "api" : ["api", "chatbot"].includes(child_details.bridgeType) ? child_details.bridgeType : agentType,
          org_id,
          gpt_memory: true,
          user_id,
          folder_id,
          fall_back,
          bridge_status: 1,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        const child_version = await agentVersionDbService.createAgentVersion(child_result.bridge);
        await ConfigurationServices.updateAgent(child_result.bridge._id.toString(), {
          versions: [child_version._id.toString()],
          published_version_id: child_version._id.toString()
        });
        createdAgentsMap.set(cycleKey, child_result.bridge._id.toString());

        // Batch all child agent updates into single DB calls
        const child_updates = {};
        const child_connected_tools = resolveConnectedTools(child_details.connected_tools);
        if (child_connected_tools) child_updates.connected_tools = child_connected_tools;
        if (child_details.agent_info && Object.keys(child_details.agent_info).length > 0) {
          child_updates.agent_info = {
            ...child_updates.agent_info,
            ...child_details.agent_info
          };
        }
        const child_api_calls = resolveApiCalls(child_details.apiCalls);
        if (child_api_calls) child_updates.apiCalls = child_api_calls;
        const child_tool_choice = resolveToolChoice(child_model_data.tool_choice);
        if (child_tool_choice !== undefined) child_updates.configuration = { ...child_model_data, tool_choice: child_tool_choice };
        if (Object.keys(child_updates).length > 0) {
          await ConfigurationServices.updateAgent(child_result.bridge._id.toString(), child_updates);
          await ConfigurationServices.updateAgent(null, child_updates, child_version._id.toString());
        }

        if (child_details.child_agents && Object.keys(child_details.child_agents).length > 0) {
          const childAncestors = new Set([...ancestorIds, cycleKey]);
          await createChildAgentsRecursively(
            child_details.child_agents,
            child_result.bridge._id.toString(),
            child_version._id.toString(),
            childAncestors,
            isEmbedUser
          );
        }

        const newChildBridgeId = child_result.bridge._id.toString();
        connected_tools.push({
          type: "agent",
          id: newChildBridgeId,
          ...pickDefined(child_agent, ["thread_id", "version_id"])
        });
      }

      if (connected_tools.length > 0) {
        await ConfigurationServices.updateAgent(parent_bridge_id, { connected_tools });
        await ConfigurationServices.updateAgent(null, { connected_tools }, parent_version_id);
      }
    };

    if (template_content?.child_agents && Object.keys(template_content.child_agents).length > 0) {
      const rootAncestorIds = new Set(rootBridgeId ? [rootBridgeId] : []);
      const isEmbedUser = req.IsEmbedUser || false;
      await createChildAgentsRecursively(
        template_content.child_agents,
        result.bridge._id.toString(),
        create_version._id.toString(),
        rootAncestorIds,
        isEmbedUser
      );
    }

    const updated_agent_result = await ConfigurationServices.getAgentsWithTools(result.bridge._id.toString(), org_id);

    res.locals = {
      success: true,
      message: "Agent created from template successfully",
      agent: updated_agent_result.bridges
    };
    req.statusCode = 200;

    return next();
  } catch (e) {
    res.locals = { success: false, message: "Error creating agent from template: " + e.message };
    req.statusCode = 400;
    return next();
  }
};

export default {
  allTemplates,
  createTemplate,
  createAgentFromTemplateController
};
