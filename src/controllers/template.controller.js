import templateService from "../db_services/template.service.js";
import ConfigurationServices from "../db_services/configuration.service.js";
import agentVersionDbService from "../db_services/agentVersion.service.js";
import apiCallModel from "../mongoModel/ApiCall.model.js";
import { ObjectId } from "mongodb";
import { getUniqueNameAndSlug, normalizeFunctionIds, cloneFunctionsForAgent } from "../utils/agentConfig.utils.js";
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
  "org_id",
  "user_id",
  "total_tokens",
  "prompt_total_tokens",
  "prompt_enhancer_percentage",
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

  // Get function data for each function_id in the bridge
  const functionData = [];
  if (bridge.function_ids && bridge.function_ids.length > 0) {
    for (const functionId of bridge.function_ids) {
      // Convert buffer to ObjectId if needed
      const id = functionId.buffer ? new ObjectId(Buffer.from(functionId.buffer)) : new ObjectId(functionId);

      const functionDetails = await apiCallModel.findOne({ _id: id }, { function_name: 1 });
      if (functionDetails) {
        functionData.push(functionDetails);
      }
    }
  }

  // Add function data to bridge
  bridge.function_data = functionData;
  bridge = filterBridge(bridge).bridge;
  bridge = Object.fromEntries(Object.entries(bridge).filter(([, v]) => v !== null));

  const buildConnectedAgents = async (connected_agents, ancestorIds = new Set()) => {
    const result = {};
    for (const [key, agent] of Object.entries(connected_agents)) {
      const agentBridgeId = agent.bridge_id?.toString() ?? agent.bridge_id;
      if (!agentBridgeId) continue;

      if (ancestorIds.has(agentBridgeId)) {
        result[key] = {
          bridge_id: agentBridgeId,
          ...(agent.thread_id !== undefined && { thread_id: agent.thread_id }),
          ...(agent.version_id !== undefined && { version_id: agent.version_id }),
          bridge_details: {}
        };
        continue;
      }

      const childBridgeData = await ConfigurationServices.getAgents(agentBridgeId);
      if (!childBridgeData.success || !childBridgeData.bridges) continue;

      let childBridge = childBridgeData.bridges;

      const childFunctionData = [];
      if (childBridge.function_ids && childBridge.function_ids.length > 0) {
        for (const functionId of childBridge.function_ids) {
          const id = functionId.buffer ? new ObjectId(Buffer.from(functionId.buffer)) : new ObjectId(functionId);
          const functionDetails = await apiCallModel.findOne({ _id: id }, { function_name: 1 });
          if (functionDetails) childFunctionData.push(functionDetails);
        }
      }
      childBridge.function_data = childFunctionData;

      const filteredBridge = Object.fromEntries(
        Object.entries(filterBridge(childBridge)?.bridge).filter(([k, v]) => v !== null && k !== "connected_agents")
      );

      if (childBridge.connected_agents && Object.keys(childBridge.connected_agents).length > 0) {
        const childAncestors = new Set([...ancestorIds, agentBridgeId]);
        filteredBridge.child_agents = await buildConnectedAgents(childBridge.connected_agents, childAncestors);
      }

      result[key] = {
        bridge_id: agentBridgeId,
        ...(agent.thread_id !== undefined && { thread_id: agent.thread_id }),
        ...(agent.version_id !== undefined && { version_id: agent.version_id }),
        bridge_details: filteredBridge
      };
    }
    return result;
  };

  if (bridge.connected_agents && Object.keys(bridge.connected_agents).length > 0) {
    bridge.child_agents = await buildConnectedAgents(bridge.connected_agents, new Set([agent_id]));
  }
  const user = "Validate the template";
  const isValid = await callAiMiddleware(user, bridge_ids["template_validator"], { template: bridge, templateName, email: req.profile?.user?.email });

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
    const agentType = req.body.bridgeType || "api";
    const meta = req.body.meta || null;

    const template_data = await ConfigurationServices.gettemplateById(template_id);
    if (!template_data) {
      res.locals = { success: false, message: "Template not found" };
      req.statusCode = 404;
      return next();
    }

    const template_content = JSON.parse(template_data.template);
    const all_agent = await ConfigurationServices.getAgentsByUserId(org_id);

    let name = template_data.templateName;
    let service = template_content?.service;
    let type = template_content?.configuration?.type;
    let prompt = template_content?.configuration?.prompt;

    const nameSlugData = getUniqueNameAndSlug(name, all_agent);
    const slugName = nameSlugData.slugName;
    name = nameSlugData.name;

    let model_data = { ...(template_content?.configuration || {}) };
    model_data.type = model_data.type || type;
    model_data.response_format = model_data.response_format || { type: "default", cred: {} };
    if (model_data.is_rich_text === undefined) model_data.is_rich_text = false;
    model_data.prompt = model_data.prompt || prompt;
    model_data.tool_choice = "default";

    const fall_back = template_content?.fall_back || { is_enable: true, service: "ai_ml", model: "gpt-oss-120b" };
    const template_fields = [
      "variables_state",
      "built_in_tools",
      "gpt_memory_context",
      "user_reference",
      "bridge_summary",
      "agent_variables",
      "guardrails",
      "actions",
      "variables_path",
      "bridge_status",
      "starterQuestion",
      "IsstarterQuestionEnable",
      "defaultQuestions",
      "page_config",
      "criteria_check",
      "auto_model_select",
      "connected_agent_details",
      "meta",
      "cache_on",
      "chatbot_auto_answers",
      "tool_call_count",
      "version_description"
    ];
    const template_values = {};
    for (const field of template_fields) {
      if (template_content[field] !== undefined) template_values[field] = template_content[field];
    }

    const result = await ConfigurationServices.createAgent({
      configuration: model_data,
      name,
      slugName,
      service,
      bridgeType: ["api", "chatbot"].includes(template_content?.bridgeType) ? template_content.bridgeType : agentType,
      org_id,
      gpt_memory: true,
      user_id,
      fall_back,
      bridge_status: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      meta,
      ...template_values
    });

    const create_version = await agentVersionDbService.createAgentVersion(result.bridge);
    await ConfigurationServices.updateAgent(result.bridge._id.toString(), {
      versions: [create_version._id.toString()],
      published_version_id: create_version._id.toString()
    });

    all_agent.push({ name, slugName });

    // --- Collect all unique function IDs and doc resource pairs across root + all children ---
    const collectAllResources = (content, allFunctionIds, allDocPairs) => {
      if (!content) return;
      for (const fid of normalizeFunctionIds(content.function_ids)) allFunctionIds.add(fid);
      if (Array.isArray(content.pre_tools)) {
        for (const tool of content.pre_tools) {
          if (tool.type === "custom_function" && tool.config?.function_id) {
            allFunctionIds.add(tool.config.function_id);
          }
        }
      }
      if (Array.isArray(content.doc_ids)) {
        for (const doc of content.doc_ids) {
          if (doc.collection_id && doc.resource_id) {
            allDocPairs.set(`${doc.collection_id}:${doc.resource_id}`, doc);
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
      const clonedIds = await cloneFunctionsForAgent(uniqueIds, org_id, result.bridge._id.toString());
      uniqueIds.forEach((oldId, i) => {
        if (clonedIds[i]) functionIdMap.set(oldId, clonedIds[i]);
      });
    }

    // Copy all unique doc resources in parallel → docIdMap (collection_id:resource_id → new entry)
    const docIdMap = new Map();
    const docEntries = [...allDocPairs.entries()];
    if (docEntries.length > 0) {
      const docResults = await Promise.allSettled(
        docEntries.map(([key, doc]) =>
          copyResourceToOrgUtil({
            collection_id: doc.collection_id,
            resource_id: doc.resource_id,
            org_id,
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
    const resolvePreTools = (pre_tools) => {
      if (!Array.isArray(pre_tools) || pre_tools.length === 0) return null;
      return pre_tools.map((tool) => {
        const clonedTool = { ...tool, config: { ...(tool.config || {}) } };
        if (tool.type === "custom_function" && tool.config?.function_id) {
          const newFid = functionIdMap.get(tool.config.function_id);
          if (newFid) clonedTool.config.function_id = newFid;
        }
        return clonedTool;
      });
    };

    const resolveDocIds = (doc_ids) => {
      if (!Array.isArray(doc_ids) || doc_ids.length === 0) return null;
      const resolved = doc_ids.map((doc) => docIdMap.get(`${doc.collection_id}:${doc.resource_id}`)).filter(Boolean);
      return resolved.length > 0 ? resolved : null;
    };

    const resolveFunctionIds = (function_ids) => {
      const ids = normalizeFunctionIds(function_ids);
      if (ids.length === 0) return null;
      const resolved = ids
        .map((id) => functionIdMap.get(id))
        .filter(Boolean)
        .map((fid) => new ObjectId(fid));
      return resolved.length > 0 ? resolved : null;
    };

    const pickDefined = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

    const resolveApiCalls = (apiCalls) => {
      if (!apiCalls || typeof apiCalls !== "object" || Object.keys(apiCalls).length === 0) return null;
      const remapped = {};
      for (const [oldKey, fn] of Object.entries(apiCalls)) {
        const newKey = functionIdMap.get(oldKey) || oldKey;
        remapped[newKey] = { ...fn, _id: newKey };
      }
      return remapped;
    };

    // Apply to root agent — batch all updates into single DB calls
    const parent_updates = {};
    const parent_function_ids_resolved = resolveFunctionIds(template_content?.function_ids);
    if (parent_function_ids_resolved) parent_updates.function_ids = parent_function_ids_resolved;
    const parent_pre_tools = resolvePreTools(template_content?.pre_tools);
    if (parent_pre_tools) parent_updates.pre_tools = parent_pre_tools;
    const parent_doc_ids = resolveDocIds(template_content?.doc_ids);
    if (parent_doc_ids) parent_updates.doc_ids = parent_doc_ids;
    const parent_api_calls = resolveApiCalls(template_content?.apiCalls);
    if (parent_api_calls) parent_updates.apiCalls = parent_api_calls;
    if (Object.keys(parent_updates).length > 0) {
      await ConfigurationServices.updateAgent(result.bridge._id.toString(), parent_updates);
      await ConfigurationServices.updateAgent(null, parent_updates, create_version._id.toString());
    }

    const createdAgentsMap = new Map();
    const rootBridgeId = template_content._id?.toString() ?? template_content._id;
    if (rootBridgeId) {
      createdAgentsMap.set(rootBridgeId, result.bridge._id.toString());
    }

    const createChildAgentsRecursively = async (child_agents_map, parent_bridge_id, parent_version_id, ancestorIds = new Set()) => {
      if (!child_agents_map || Object.keys(child_agents_map).length === 0) return;
      const connected_agents = {};

      for (const [agent_name, child_agent] of Object.entries(child_agents_map)) {
        const templateBridgeId = child_agent?.bridge_id?.toString() ?? child_agent?.bridge_id;
        const cycleKey = templateBridgeId || agent_name;

        if (ancestorIds.has(cycleKey)) {
          const existingBridgeId = createdAgentsMap.get(cycleKey);
          if (existingBridgeId) {
            connected_agents[existingBridgeId] = { bridge_id: existingBridgeId, ...pickDefined(child_agent, ["thread_id", "version_id"]) };
          }
          continue;
        }

        // Same agent referenced by multiple parents — reuse already-created bridge
        if (createdAgentsMap.has(cycleKey)) {
          const reusedId = createdAgentsMap.get(cycleKey);
          connected_agents[reusedId] = { bridge_id: reusedId, ...pickDefined(child_agent, ["thread_id", "version_id"]) };
          continue;
        }

        const child_details = child_agent?.bridge_details;
        if (!child_details || Object.keys(child_details).length === 0) continue;

        const childNameSlug = getUniqueNameAndSlug(agent_name, all_agent);
        const child_model_data = { ...(child_details.configuration || {}) };
        child_model_data.type = child_model_data.type || type;
        child_model_data.response_format = child_model_data.response_format || { type: "default", cred: {} };
        if (child_model_data.is_rich_text === undefined) child_model_data.is_rich_text = false;
        child_model_data.prompt = child_model_data.prompt || prompt;
        child_model_data.tool_choice = "default";

        let child_service = child_details.service || service;
        const child_template_values = {};
        for (const field of template_fields) {
          if (child_details[field] !== undefined) child_template_values[field] = child_details[field];
        }

        const child_result = await ConfigurationServices.createAgent({
          configuration: child_model_data,
          name: childNameSlug.name,
          slugName: childNameSlug.slugName,
          service: child_service,
          bridgeType: ["api", "chatbot"].includes(child_details.bridgeType) ? child_details.bridgeType : agentType,
          org_id,
          gpt_memory: true,
          user_id,
          fall_back,
          bridge_status: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...child_template_values
        });

        const child_version = await agentVersionDbService.createAgentVersion(child_result.bridge);
        await ConfigurationServices.updateAgent(child_result.bridge._id.toString(), {
          versions: [child_version._id.toString()],
          published_version_id: child_version._id.toString()
        });
        all_agent.push({ name: childNameSlug.name, slugName: childNameSlug.slugName });
        createdAgentsMap.set(cycleKey, child_result.bridge._id.toString());

        // Batch all child agent updates into single DB calls
        const child_updates = {};
        const child_function_ids_resolved = resolveFunctionIds(child_details.function_ids);
        if (child_function_ids_resolved) child_updates.function_ids = child_function_ids_resolved;
        const child_pre_tools = resolvePreTools(child_details.pre_tools);
        if (child_pre_tools) child_updates.pre_tools = child_pre_tools;
        if (child_details.connected_agent_details && Object.keys(child_details.connected_agent_details).length > 0) {
          child_updates.connected_agent_details = child_details.connected_agent_details;
        }
        const child_doc_ids = resolveDocIds(child_details.doc_ids);
        if (child_doc_ids) child_updates.doc_ids = child_doc_ids;
        const child_api_calls = resolveApiCalls(child_details.apiCalls);
        if (child_api_calls) child_updates.apiCalls = child_api_calls;
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
            childAncestors
          );
        }

        const newChildBridgeId = child_result.bridge._id.toString();
        connected_agents[newChildBridgeId] = {
          bridge_id: newChildBridgeId,
          ...pickDefined(child_agent, ["thread_id", "version_id"])
        };
      }

      if (Object.keys(connected_agents).length > 0) {
        await ConfigurationServices.updateAgent(parent_bridge_id, { connected_agents });
        await ConfigurationServices.updateAgent(null, { connected_agents }, parent_version_id);
      }
    };

    if (template_content?.child_agents && Object.keys(template_content.child_agents).length > 0) {
      const rootAncestorIds = new Set(rootBridgeId ? [rootBridgeId] : []);
      await createChildAgentsRecursively(template_content.child_agents, result.bridge._id.toString(), create_version._id.toString(), rootAncestorIds);
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
