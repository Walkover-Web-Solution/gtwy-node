import service from "../db_services/apiCall.service.js";
import { validateRequiredParams } from "../services/utils/apiCall.utils.js";
import ConfigurationServices from "../db_services/configuration.service.js";
import Helper from "../services/utils/helper.utils.js";
import agentVersionService from "../db_services/agentVersion.service.js";
import { deleteInCache } from "../cache_service/index.js";

const getAllApiCalls = async (req, res, next) => {
  const org_id = req.profile?.org?.id;
  const folder_id = req.profile?.extraDetails?.folder_id || null;
  const user_id = req.profile?.user?.id;
  const isEmbedUser = req.IsEmbedUser;

  const functions = await service.getAllApiCallsByOrgId(org_id, folder_id, user_id, isEmbedUser);

  res.locals = {
    success: true,
    message: "Get all functions of a org successfully",
    data: functions,
    org_id: org_id
  };
  req.statusCode = 200;
  return next();
};

const updateApiCalls = async (req, res, next) => {
  const org_id = req.profile?.org?.id;
  const { function_id } = req.params;
  const { dataToSend } = req.body;
  let data_to_update = validateRequiredParams(dataToSend);

  const data = await service.getFunctionById(function_id);
  const old_fields = data.fields || {};

  data_to_update = {
    ...data_to_update,
    old_fields: old_fields
  };

  const updated_function = await service.updateApiCallByFunctionId(org_id, function_id, data_to_update);

  const bridge_ids = updated_function?.data?.bridge_ids || [];
  if (bridge_ids.length > 0) {
    const keys_to_delete = bridge_ids.flatMap((id) => agentVersionService._buildCacheKeys(id, id, { bridges: [], versions: [] }, [], org_id));
    deleteInCache(keys_to_delete);
  }

  res.locals = {
    success: true,
    data: updated_function.data
  };
  req.statusCode = 200;
  return next();
};

const deleteFunction = async (req, res, next) => {
  const org_id = req.profile?.org?.id;
  const { script_id } = req.body;

  const result = await service.deleteFunctionFromApicallsDb(org_id, script_id);
  res.locals = result;
  req.statusCode = 200;
  return next();
};

const createApi = async (req, res, next) => {
  try {
    const { id: script_id, status, title, desc } = req.body;
    const org_id = req.profile.org.id;
    const folder_id = req.folder_id || null;
    const user_id = req.profile.user.id;
    const isEmbedUser = req.embed;

    if (status === "published" || status === "updated") {
      const properties = req.body?.openaiToolJson?.function?.parameters?.properties || {};
      const required = req.body?.openaiToolJson?.function?.parameters?.required || [];

      const fields = Helper.transformFieldsStructure(properties);
      const required_params = required.filter((k) => fields[k]);

      const api_data = await service.getApiData(org_id, script_id, folder_id, user_id, isEmbedUser);
      const cleanedTitle = Helper.makeFunctionName(title || script_id || "");

      const result = await service.saveApi(desc, org_id, folder_id, user_id, api_data, [], script_id, fields, cleanedTitle, required_params);
      if (result.success) {
        const responseData = result.api_data;
        responseData._id = responseData._id.toString();
        if (responseData.bridge_ids) {
          responseData.bridge_ids = responseData.bridge_ids.map((bid) => bid.toString());
        }

        res.locals = {
          message: "API saved successfully",
          success: true,
          data: responseData
        };
        req.statusCode = 200;
        return next();
      } else {
        res.locals = { success: false, message: "Something went wrong!" };
        req.statusCode = 400;
        return next();
      }
    } else if (status === "delete" || status === "paused") {
      const result = await service.deleteFunctionFromApicallsDb(org_id, script_id);
      if (result.success) {
        res.locals = {
          message: "API deleted successfully",
          success: true,
          deleted: true,
          data: result
        };
        req.statusCode = 200;
        return next();
      } else {
        res.locals = { success: false, message: result.message || "Something went wrong!" };
        req.statusCode = 400;
        return next();
      }
    }

    res.locals = { success: false, message: "Something went wrong!" };
    req.statusCode = 400;
    return next();
  } catch (e) {
    console.error("Error in createApi:", e);
    res.locals = { success: false, message: e.message };
    req.statusCode = 400;
    return next();
  }
};

const addPreTool = async (req, res, next) => {
  try {
    const { agent_id: bridgeId } = req.params;
    const { version_id, pre_tools: pre_tool_entry, status } = req.body;
    const org_id = req.profile.org.id;

    const model_config = await ConfigurationServices.getAgentsWithTools(bridgeId, org_id, version_id);

    if (!model_config.success) {
      res.locals = { success: false, message: "bridge id is not found" };
      req.statusCode = 400;
      return next();
    }

    const current_pre_tools = model_config.bridges?.pre_tools || [];
    const data_to_update = {};

    if (status === "1") {
      // Prevent adding a new tool if one already exists (only one pre-tool allowed)
      if (current_pre_tools.length > 0) {
        res.locals = { success: false, message: "A pre-tool is already configured. Remove it before adding a new one." };
        req.statusCode = 400;
        return next();
      }
      data_to_update["pre_tools"] = [...current_pre_tools, pre_tool_entry];
    } else {
      data_to_update["pre_tools"] = current_pre_tools.filter((t) => t.type !== pre_tool_entry?.type);
    }
    await ConfigurationServices.updateAgent(bridgeId, data_to_update, version_id);
    const result = await ConfigurationServices.getAgentsWithTools(bridgeId, org_id, version_id);

    // Only update ApiCall bridge_ids for custom_function type (others are not tracked as functions)
    if (pre_tool_entry.type === "custom_function" && pre_tool_entry?.config?.function_id) {
      await ConfigurationServices.updateAgentIdsInApiCalls(pre_tool_entry?.config?.function_id, version_id || bridgeId, parseInt(status));
    }

    if (result.success) {
      const response = await Helper.responseMiddlewareForBridge(
        result.bridges.service,
        {
          success: true,
          message: "Agent pre-tool updated successfully",
          agent: result.bridges
        },
        true
      );

      res.locals = response;
      req.statusCode = 200;
      return next();
    } else {
      res.locals = result;
      req.statusCode = 400;
      return next();
    }
  } catch (e) {
    console.error("Error in addPreTool:", e);
    res.locals = { success: false, message: e.message };
    req.statusCode = 400;
    return next();
  }
};

const getAllInBuiltToolsController = async (req, res, next) => {
  res.locals = {
    success: true,
    message: "Get all inbuilt tools successfully",
    in_built_tools: [
      {
        id: "1",
        name: "Web Search",
        description: "Allow models to search the web for the latest information before generating a response.",
        value: "web_search"
      },
      {
        id: "2",
        name: "image generation",
        description: "Allow models to generate images based on the user's input.",
        value: "image_generation"
      },
      {
        id: "3",
        name: "Gtwy web search",
        description: "Allow models that support tool calling to search the web for the latest information before generating a response.",
        value: "Gtwy_Web_Search"
      }
    ]
  };
  req.statusCode = 200;
  return next();
};

export default {
  getAllApiCalls,
  updateApiCalls,
  deleteFunction,
  createApi,
  addPreTool,
  getAllInBuiltToolsController
};
