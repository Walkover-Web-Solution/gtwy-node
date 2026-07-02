import apiCallModel from "../mongoModel/ApiCall.model.js";
import versionModel from "../mongoModel/BridgeVersion.model.js";
import configurationModel from "../mongoModel/Configuration.model.js";
import mongoose from "mongoose";
import { deleteInCache } from "../cache_service/index.js";
import agentVersionService from "../db_services/agentVersion.service.js";

async function getAllApiCallsByOrgId(org_id, folder_id, user_id, isEmbedUser) {
  let query = { org_id: org_id };
  if (folder_id) {
    query.folder_id = folder_id;
  } else {
    query.folder_id = { $in: [null, ""] };
  }
  if (user_id && isEmbedUser) query.user_id = user_id.toString();

  let apiCalls = await apiCallModel.find(query).lean();
  return apiCalls || [];
}

async function updateApiCallByFunctionId(org_id, function_id, data_to_update) {
  const updatedDocument = await apiCallModel.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(function_id),
      org_id: org_id
    },
    { $set: data_to_update },
    { new: true }
  );

  if (!updatedDocument) {
    throw new Error("Document not found or not modified.");
  }

  // Cache invalidation logic would go here if Redis was set up
  // const bridge_ids = updatedDocument.bridge_ids || [];
  // const version_ids = updatedDocument.version_ids || [];
  // ...

  return {
    success: true,
    data: updatedDocument
  };
}

async function getFunctionById(function_id) {
  try {
    const dbData = await apiCallModel.findOne({ _id: new mongoose.Types.ObjectId(function_id) });
    if (!dbData) {
      throw new Error("Function not found.");
    }
    return dbData;
  } catch (error) {
    throw new Error(`Error retrieving function: ${error.message}`);
  }
}

async function deleteFunctionFromApicallsDb(org_id, script_id) {
  const functionData = await apiCallModel.findOne({ org_id: org_id, script_id: script_id }, { _id: 1 });

  if (!functionData) {
    throw new Error("No matching function found to delete.");
  }

  const function_id_str = functionData._id.toString();

  // Find all versions that have this function_id in either function_ids or pre_tools
  const versionsWithFunction = await versionModel
    .find(
      {
        org_id: org_id,
        $or: [{ function_ids: function_id_str }, { "pre_tools.config.function_id": function_id_str }]
      },
      { parent_id: 1 }
    )
    .lean();

  // Get unique bridge_ids from those versions
  const bridge_ids = [...new Set(versionsWithFunction.map((v) => v.parent_id).filter(Boolean))];
  const version_ids = versionsWithFunction.map((v) => v._id);

  // Prepare all update operations
  const updateOperations = [];

  // Use raw collection driver to bypass mongoose casting so string filters match stored string values
  const bridge_id_objs = bridge_ids.map((id) => new mongoose.Types.ObjectId(id));

  if (bridge_ids.length > 0) {
    updateOperations.push(configurationModel.collection.updateMany({ _id: { $in: bridge_id_objs } }, { $pull: { function_ids: function_id_str } }));
  }

  if (version_ids.length > 0) {
    updateOperations.push(versionModel.collection.updateMany({ _id: { $in: version_ids } }, { $pull: { function_ids: function_id_str } }));
  }

  if (bridge_ids.length > 0) {
    updateOperations.push(
      configurationModel.collection.updateMany({ _id: { $in: bridge_id_objs } }, { $pull: { pre_tools: { "config.function_id": function_id_str } } })
    );
  }

  if (version_ids.length > 0) {
    updateOperations.push(
      versionModel.collection.updateMany({ _id: { $in: version_ids } }, { $pull: { pre_tools: { "config.function_id": function_id_str } } })
    );
  }

  // Execute all update operations in parallel
  await Promise.all(updateOperations);

  const result = await apiCallModel.deleteOne({
    org_id: org_id,
    script_id: script_id
  });

  if (result.deletedCount > 0) {
    return {
      success: true,
      message: "Function deleted successfully."
    };
  } else {
    throw new Error("No matching function found to delete.");
  }
}

async function createApiCall(data) {
  const apiCall = new apiCallModel(data);
  return await apiCall.save();
}

async function getApiData(org_id, script_id, folder_id, user_id, isEmbedUser) {
  const query = { org_id: org_id, script_id: script_id };
  if (folder_id) query.folder_id = folder_id;
  if (user_id && isEmbedUser) query.user_id = user_id;

  const apiData = await apiCallModel.findOne(query).lean();
  return apiData || {};
}

/**
 * @param {Array} required - List of top-level field keys required for this API call
 */
async function saveApi(desc, org_id, folder_id, user_id, api_data, bridge_ids = [], script_id, fields, title, required = []) {
  const updateData = {
    description: desc,
    org_id: org_id,
    script_id: script_id,
    title: title,
    required: required
  };

  // Helper function to check if a value is empty
  const isEmpty = (value) => {
    if (value === null || value === undefined || value === "") return true;
    if (typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value).length === 0;
    }
    if (Array.isArray(value)) {
      return value.length === 0;
    }
    return false;
  };

  // Only update fields if new value is not empty, or if there's no existing value
  if (api_data && api_data._id) {
    // For updates: preserve existing non-empty values when new values are empty
    if (!isEmpty(fields)) {
      updateData.fields = fields;
    } else if (isEmpty(api_data.fields)) {
      // Only set empty if existing is also empty
      updateData.fields = fields;
    }
    // If fields is empty but api_data.fields is not empty, don't include fields in updateData
  } else {
    // For new records: always set fields
    updateData.fields = fields;
  }

  if (folder_id) updateData.folder_id = folder_id;
  if (user_id) updateData.user_id = user_id;

  if (api_data && api_data._id) {
    // Update existing
    const updatedApi = await apiCallModel.findOneAndUpdate({ _id: api_data._id }, { $set: updateData }, { new: true, upsert: true }).lean();
    const ids_to_purge = updatedApi?.bridge_ids || [];
    if (ids_to_purge.length > 0) {
      const keys_to_delete = ids_to_purge.flatMap((id) => agentVersionService._buildCacheKeys(id, id, { bridges: [], versions: [] }, [], org_id));
      deleteInCache(keys_to_delete);
    }
    return { success: true, api_data: updatedApi };
  } else {
    // Create new
    updateData.bridge_ids = bridge_ids;
    const newApi = await apiCallModel.create(updateData);
    return { success: true, api_data: newApi };
  }
}

async function getAgentsAndVersionsByFunctionIds(org_id) {
  try {
    const configurations = await configurationModel
      .find({ org_id: org_id, function_ids: { $exists: true, $ne: [] } })
      .select({ _id: 1, function_ids: 1, name: 1 })
      .lean();

    const versions = await versionModel
      .find({ org_id: org_id, function_ids: { $exists: true, $ne: [] } })
      .select({ _id: 1, function_ids: 1, parent_id: 1, name: 1 })
      .lean();

    const result = {};

    for (const config of configurations) {
      const agent_id = config._id.toString();
      for (const functionId of config.function_ids || []) {
        const key = functionId && functionId.toString ? functionId.toString() : String(functionId);

        if (!result[key]) {
          result[key] = {};
        }

        if (!result[key][agent_id]) {
          result[key][agent_id] = [];
        }
      }
    }

    for (const version of versions) {
      const version_id = version._id.toString();
      const parent_id = version.parent_id ? version.parent_id.toString() : null;

      for (const functionId of version.function_ids || []) {
        const key = functionId && functionId.toString ? functionId.toString() : String(functionId);

        if (!result[key]) {
          result[key] = {};
        }

        if (parent_id) {
          if (!result[key][parent_id]) {
            result[key][parent_id] = [];
          }
          if (!result[key][parent_id].includes(version_id)) {
            result[key][parent_id].push(version_id);
          }
        }
      }
    }

    return {
      success: true,
      data: result
    };
  } catch (error) {
    console.error("Error in getAgentsAndVersionsByFunctionIds:", error);
    throw error;
  }
}

export default {
  getAllApiCallsByOrgId,
  updateApiCallByFunctionId,
  getFunctionById,
  deleteFunctionFromApicallsDb,
  createApiCall,
  getApiData,
  saveApi,
  getAgentsAndVersionsByFunctionIds
};
