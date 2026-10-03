import isEqual from "lodash/isEqual.js";
import service from "../db_services/apiCall.service.js";
import { validateRequiredParams } from "../services/utils/apiCall.utils.js";
import Helper from "../services/utils/helper.utils.js";
import agentVersionService from "../db_services/agentVersion.service.js";
import { deleteInCache } from "../cache_service/index.js";
import { syncToolToViasocketEmbed } from "../services/utils/viasocketSync.utils.js";
import apiCallService from "../db_services/apiCall.service.js";
import conversationDbService from "../db_services/conversation.service.js";

const { addBulkUserEntries } = conversationDbService;

// The only fields a user edits on a tool. The client sends the whole document
// back on save, so everything else it carries — old_fields, updatedAt, __v —
// would be logged as a change without this list.
const TOOL_HISTORY_FIELDS = ["title", "description", "fields", "required"];

// Shared by both tool-update paths: the manual config form (updateApiCalls) and the
// Viasocket builder sync (createApi's "updated" status) — one row per changed field.
function buildToolFieldDiffEntries(before, after, historyBase) {
  return TOOL_HISTORY_FIELDS.filter((key) => !isEqual(before?.[key], after?.[key])).map((key) => ({
    ...historyBase,
    type: key,
    previous_value: before?.[key] ?? null,
    current_value: after?.[key] ?? null
  }));
}

function toolSnapshot(doc) {
  return {
    title: doc?.title ?? null,
    description: doc?.description ?? null,
    fields: doc?.fields ?? null,
    required: doc?.required ?? null
  };
}

// Used by both delete entry points (the trash-icon delete and the Viasocket builder's
// delete/pause callback) so the behaviour — and the history it writes — stays identical.
async function deleteToolAndLogHistory(org_id, script_id, historyBase) {
  const result = await service.deleteFunctionFromApicallsDb(org_id, script_id);

  try {
    const entries = [
      {
        ...historyBase,
        config_id: String(result.deletedTool._id),
        type: "Tool deleted",
        previous_value: toolSnapshot(result.deletedTool),
        current_value: null
      },
      // The tool's own history disappears with it, so its removal is also logged on
      // every agent it was connected to — that's the only place left to see it.
      ...(result.affectedBridgeIds || []).map((bridgeId) => ({
        ...historyBase,
        config_id: String(bridgeId),
        type: "Tool removed",
        previous_value: toolSnapshot(result.deletedTool),
        current_value: null
      }))
    ];
    await addBulkUserEntries(entries);
  } catch (historyError) {
    // History should not block tool deletion.
    console.error("Failed to add tool deletion history:", historyError);
  }

  return result;
}

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

  try {
    // flattenMaps: `fields` is a Map, and a Map serialises into JSON as {}.
    const before = data.toObject({ flattenMaps: true });
    const after = updated_function.data.toObject({ flattenMaps: true });
    const historyBase = {
      user_id: String(req.profile?.user?.id),
      org_id: String(org_id),
      // The tool is its own subject here — it has no version of its own.
      config_id: String(function_id),
      version_id: "",
      time: new Date()
    };

    // One row per changed field, the same way an agent logs its own fields, so the
    // history says which detail changed rather than just that the tool changed.
    const user_history = buildToolFieldDiffEntries(before, after, historyBase);

    if (user_history.length > 0) {
      await addBulkUserEntries(user_history);
    }
  } catch (historyError) {
    // History should not block tool update responses.
    console.error("Failed to add tool history:", historyError);
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

  const result = await deleteToolAndLogHistory(org_id, script_id, {
    user_id: String(req.profile?.user?.id),
    org_id: String(org_id),
    version_id: "",
    time: new Date()
  });
  res.locals = result;
  req.statusCode = 200;
  return next();
};

const createApi = async (req, res, next) => {
  try {
    const { id: script_id, status, title, desc, url } = req.body;
    const org_id = req.profile.org.id;
    const folder_id = req.folder_id || null;
    const user_id = req.profile.user.id;
    const isEmbedUser = req.embed;

    if (status === "published" || status === "updated") {
      const fields = req.body?.openaiToolJson?.function?.parameters?.properties || {};
      const requiredList = req.body?.openaiToolJson?.function?.parameters?.required || [];
      const required = requiredList.filter((k) => fields[k]);

      const api_data = await service.getApiData(org_id, script_id, folder_id, user_id, isEmbedUser);
      const isNewTool = !api_data?._id;
      const cleanedTitle = Helper.makeFunctionName(title || script_id || "");

      const result = await service.saveApi(desc, org_id, folder_id, user_id, api_data, [], script_id, fields, cleanedTitle, required, url);
      if (result.success) {
        const responseData = result.api_data;

        try {
          const historyBase = {
            user_id: String(user_id),
            org_id: String(org_id),
            config_id: String(responseData._id),
            version_id: "",
            time: new Date()
          };
          // This is the Viasocket builder's own save path — a user editing a tool's
          // script/fields there never touches updateApiCalls, so without this it would
          // never show up in the tool's history at all.
          const entries = isNewTool
            ? [{ ...historyBase, type: "Tool created", previous_value: null, current_value: toolSnapshot(responseData) }]
            : buildToolFieldDiffEntries(api_data, responseData, historyBase);
          if (entries.length > 0) await addBulkUserEntries(entries);
        } catch (historyError) {
          console.error("Failed to add tool history from embed sync:", historyError);
        }

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
      const result = await deleteToolAndLogHistory(org_id, script_id, {
        user_id: String(user_id),
        org_id: String(org_id),
        version_id: "",
        time: new Date()
      });
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
        isGtwyTool: true,
        description: "Allow models that support tool calling to search the web for the latest information before generating a response.",
        value: "Gtwy_Web_Search"
      },
      {
        id: "4",
        name: "GTWY Browser",
        description: "Allow models that support Browser to run and access any website.",
        isGtwyTool: true,
        value: "Gtwy_Browser"
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
