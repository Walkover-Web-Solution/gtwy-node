import service from "../db_services/apiCall.service.js";
import { validateRequiredParams } from "../services/utils/apiCall.utils.js";
import Helper from "../services/utils/helper.utils.js";
import agentVersionService from "../db_services/agentVersion.service.js";
import { deleteInCache } from "../cache_service/index.js";
import { syncToolToViasocketEmbed } from "../services/utils/viasocketSync.utils.js";
import apiCallService from "../db_services/apiCall.service.js";

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

  try {
    await syncToolToViasocketEmbed(updated_function.data, org_id, {
      folder_id: req.folder_id || null,
      user_id: req.profile?.user?.id || null,
      isEmbedUser: req.embed
    });
  } catch (error) {
    console.error(`Failed to sync tool ${updated_function?.data?.script_id} to viasocket embed:`, error.message);
  }

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
      const fields = req.body?.openaiToolJson?.function?.parameters?.properties || {};
      const requiredList = req.body?.openaiToolJson?.function?.parameters?.required || [];
      const required = requiredList.filter((k) => fields[k]);

      const api_data = await service.getApiData(org_id, script_id, folder_id, user_id, isEmbedUser);
      const cleanedTitle = Helper.makeFunctionName(title || script_id || "");

      const result = await service.saveApi(desc, org_id, folder_id, user_id, api_data, [], script_id, fields, cleanedTitle, required);
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

const getAgentsAndVersionsByFunctionIds = async (req, res, next) => {
  const org_id = req.profile?.org?.id;
  const result = await apiCallService.getAgentsAndVersionsByFunctionIds(org_id);
  res.locals = {
    success: result.success,
    message: "Agents and versions by function IDs retrieved successfully",
    data: result.data
  };
  req.statusCode = 200;
  return next();
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
        name: "Image Generation",
        description: "Allow models to generate images based on the user's input.",
        value: "image_generation"
      },
      {
        id: "3",
        name: "GTWY Web Search",
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
  getAllInBuiltToolsController,
  getAgentsAndVersionsByFunctionIds
};
