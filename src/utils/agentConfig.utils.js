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
  // Deprecated: This function is kept for backward compatibility
  // New code should work with connected_tools directly
  if (!function_ids) return [];
  if (Array.isArray(function_ids)) return function_ids;
  if (typeof function_ids === "object") return Object.values(function_ids);
  return [];
};

const cloneFunctionsForAgent = async (function_ids, org_id, agent_id, folder_id = null, user_id = null, isEmbedUser = false) => {
  // Deprecated: This function is kept for backward compatibility
  // New code should use cloneConnectedToolsForAgent instead
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

const cloneConnectedToolsForAgent = async (connected_tools, org_id, agent_id, folder_id = null, user_id = null, isEmbedUser = false) => {
  const cloned_tools = [];

  for (const tool of connected_tools || []) {
    if (tool.type === "tools") {
      // Clone tool functions
      const cloned_tool_ids = await cloneFunctionsForAgent([tool.id], org_id, agent_id, folder_id, user_id, isEmbedUser);
      if (cloned_tool_ids.length > 0) {
        cloned_tools.push({ ...tool, id: cloned_tool_ids[0] });
      }
    } else {
      // For other tool types (agent, docs, pre_tool), just copy the reference
      cloned_tools.push(tool);
    }
  }

  return cloned_tools;
};

export { getUniqueNameAndSlug, normalizeFunctionIds, cloneFunctionsForAgent, cloneConnectedToolsForAgent };
