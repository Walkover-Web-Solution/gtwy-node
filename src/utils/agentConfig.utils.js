import { ObjectId } from "mongodb";
import apiCallModel from "../mongoModel/ApiCall.model.js";
import axios from "axios";
import { getViasocketEmbedToken } from "../services/utils/viasocketSync.utils.js";

const getUniqueNameAndSlug = (baseName, allAgents) => {
  const name = baseName || "untitled_agent";
  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameRegex = new RegExp(`^${escapeRegExp(name)}(?:_(\\d+))?$`);

  let name_next_count = 1;
  let slug_next_count = 1;

  for (const agent of allAgents) {
    const nameMatch = agent.name?.match(nameRegex);
    if (nameMatch) {
      const num = nameMatch[1] ? parseInt(nameMatch[1], 10) : 0;
      if (num >= name_next_count) name_next_count = num + 1;
    }

    const slugMatch = agent.slugName?.match(nameRegex);
    if (slugMatch) {
      const num = slugMatch[1] ? parseInt(slugMatch[1], 10) : 0;
      if (num >= slug_next_count) slug_next_count = num + 1;
    }
  }

  return {
    name: baseName || `${name}_${name_next_count}`,
    slugName: `${name}_${slug_next_count}`
  };
};

const normalizeFunctionIds = (function_ids) => {
  if (!function_ids) return [];
  if (Array.isArray(function_ids)) return function_ids;
  if (typeof function_ids === "object") return Object.values(function_ids);
  return [];
};

const cloneFunctionsForAgent = async (function_ids, org_id, agent_id, folder_id = null, user_id = null, isEmbedUser = false) => {
  const cloned_function_ids = [];
  const ids = normalizeFunctionIds(function_ids);

  for (const function_id of ids) {
    if (!function_id) continue;
    let functionObjectId = null;
    try {
      functionObjectId = function_id?.buffer ? new ObjectId(Buffer.from(function_id.buffer)) : new ObjectId(function_id);
    } catch {
      console.error("Invalid function id in template:", function_id);
      continue;
    }

    const original_api_call = await apiCallModel.findOne({ _id: functionObjectId }).lean();
    if (!original_api_call || !original_api_call.script_id) {
      continue;
    }

    const existing_api_call = await apiCallModel
      .findOne({
        org_id: org_id,
        script_id: original_api_call.script_id
      })
      .lean();

    if (existing_api_call) {
      await apiCallModel.updateOne(
        { _id: existing_api_call._id },
        {
          $addToSet: { bridge_ids: agent_id.toString() }
        }
      );
      cloned_function_ids.push(existing_api_call._id.toString());
      continue;
    }

    try {
      const auth_token = getViasocketEmbedToken({ org_id, folder_id, user_id, isEmbedUser });

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
        new_api_call.org_id = org_id;
        new_api_call.script_id = duplicate_data.data.id;
        new_api_call.bridge_ids = [agent_id.toString()];
        new_api_call.folder_id = folder_id || "";
        new_api_call.user_id = user_id || "";
        new_api_call.version_ids = [];

        const new_api_call_result = await new apiCallModel(new_api_call).save();
        cloned_function_ids.push(new_api_call_result._id.toString());
      } else {
        console.error(`Failed to duplicate function ${original_api_call.script_id}:`, duplicate_data);
      }
    } catch (e) {
      console.error(`Error duplicating function ${original_api_call.script_id || function_id}:`, e);
      const new_api_call = { ...original_api_call };
      delete new_api_call._id;
      new_api_call.org_id = org_id;
      new_api_call.bridge_ids = [agent_id.toString()];
      new_api_call.folder_id = folder_id || "";
      new_api_call.user_id = user_id || "";
      new_api_call.version_ids = [];

      const new_api_call_result = await new apiCallModel(new_api_call).save();
      cloned_function_ids.push(new_api_call_result._id.toString());
    }
  }

  return cloned_function_ids;
};

const normalizeConnectedTools = (connected_tools) => {
  if (!connected_tools) return { tools: {} };

  // If new tools structure already exists, use it
  let tools = connected_tools.tools || {};

  // For backward compatibility: if tools is empty, but we have legacy fields, populate tools
  if (Object.keys(tools).length === 0) {
    const varsPath = connected_tools.variables_path || {};

    // 1. function_ids
    if (Array.isArray(connected_tools.function_ids)) {
      for (const fid of connected_tools.function_ids) {
        if (!fid) continue;
        const idStr = fid.toString();
        tools[idStr] = {
          type: "function",
          variable_path: varsPath[idStr] || {}
        };
      }
    }

    // 2. connected_agents
    if (connected_tools.connected_agents && typeof connected_tools.connected_agents === 'object') {
      for (const [key, agent] of Object.entries(connected_tools.connected_agents)) {
        if (!agent) continue;
        tools[key] = {
          type: "agent",
          bridge_id: agent.bridge_id || key,
          version_id: agent.version_id,
          thread_id: agent.thread_id !== undefined ? agent.thread_id : true,
          variable_path: varsPath[key] || {}
        };
      }
    }

    // 3. built_in_tools
    if (Array.isArray(connected_tools.built_in_tools)) {
      for (const toolName of connected_tools.built_in_tools) {
        if (!toolName) continue;
        tools[toolName] = {
          type: "builtin",
          variable_path: varsPath[toolName] || {}
        };
      }
    }

    // 4. doc_ids
    if (Array.isArray(connected_tools.doc_ids)) {
      for (const doc of connected_tools.doc_ids) {
        if (!doc) continue;
        let docId = doc;
        let details = {};
        if (typeof doc === 'object') {
          docId = doc.resource_id || doc.collection_id || JSON.stringify(doc);
          details = doc;
        }
        tools[docId] = {
          type: "knowledgebase",
          ...details,
          variable_path: varsPath[docId] || {}
        };
      }
    }
  }

  // Reconstruct compatibility fields so rest of code does not break
  const function_ids = [];
  const connected_agents = {};
  const built_in_tools = [];
  const doc_ids = [];
  const variables_path = {};

  for (const [key, tool] of Object.entries(tools)) {
    if (!tool) continue;
    if (tool.variable_path) {
      variables_path[key] = tool.variable_path;
    }
    if (tool.type === "function") {
      function_ids.push(key);
    } else if (tool.type === "agent") {
      connected_agents[key] = {
        bridge_id: tool.bridge_id || key,
        version_id: tool.version_id,
        thread_id: tool.thread_id !== undefined ? tool.thread_id : true
      };
    } else if (tool.type === "builtin") {
      built_in_tools.push(key);
    } else if (tool.type === "knowledgebase") {
      const { type, variable_path, ...rest } = tool;
      if (Object.keys(rest).length > 0) {
        doc_ids.push({ resource_id: key, ...rest });
      } else {
        doc_ids.push(key);
      }
    }
  }

  return {
    ...connected_tools,
    tools,
    function_ids,
    connected_agents,
    built_in_tools,
    doc_ids,
    variables_path
  };
};

export { getUniqueNameAndSlug, normalizeFunctionIds, cloneFunctionsForAgent, normalizeConnectedTools };
