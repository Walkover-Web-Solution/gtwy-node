import apiCallModel from "../mongoModel/ApiCall.model.js";
import versionModel from "../mongoModel/BridgeVersion.model.js";
import mongoose from "mongoose";
import { deleteInCache } from "../cache_service/index.js";
import agentVersionService from "../db_services/agentVersion.service.js";

async function getAllApiCallsByOrgId(org_id, folder_id, user_id, isEmbedUser) {
  let query = { org_id: org_id };
  if (folder_id) query.folder_id = folder_id;
  if (user_id && isEmbedUser) query.user_id = user_id.toString();

  const pipeline = [
    { $match: query },
    {
      $addFields: {
        _id: { $toString: "$_id" },
        bridge_ids: {
          $map: {
            input: "$bridge_ids",
            as: "bridge_id",
            in: { $toString: "$$bridge_id" }
          }
        },
        createdAt: {
          $cond: {
            if: { $eq: [{ $type: "$createdAt" }, "string"] },
            then: "$createdAt",
            else: { $dateToString: { format: "%Y-%m-%d %H:%M:%S", date: "$createdAt" } }
          }
        },
        updatedAt: {
          $cond: {
            if: { $eq: [{ $type: "$updatedAt" }, "string"] },
            then: "$updatedAt",
            else: { $dateToString: { format: "%Y-%m-%d %H:%M:%S", date: "$updatedAt" } }
          }
        }
      }
    }
  ];

  let apiCalls = await apiCallModel.aggregate(pipeline);

  // All documents should now be in v2 format after migration
  // Fields are already in the correct object format: { paramName: { description, type, enum, required_params, parameter } }
  // No transformation needed
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
  const bridgeData = await apiCallModel.findOne({ org_id: org_id, script_id: script_id }, { bridge_ids: 1, version_ids: 1, _id: 1 });

  if (!bridgeData) {
    throw new Error("No matching function found to delete.");
  }

  const bridge_ids = bridgeData.bridge_ids || [];
  const version_ids = bridgeData.version_ids || [];
  const function_id = bridgeData._id;

  if (bridge_ids.length > 0) {
    await versionModel.updateMany({ _id: { $in: bridge_ids } }, { $pull: { function_ids: function_id } });
  }

  if (version_ids.length > 0) {
    await versionModel.updateMany({ _id: { $in: version_ids } }, { $pull: { function_ids: function_id } });
  }

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
 * @param {Array} required_params - List of top-level field keys required for this API call
 */
async function saveApi(desc, org_id, folder_id, user_id, api_data, bridge_ids = [], script_id, fields, title, required_params = []) {
  const updateData = {
    description: desc,
    org_id: org_id,
    script_id: script_id,
    title: title,
    required_params: required_params
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
      const keys_to_delete = ids_to_purge.flatMap((id) => agentVersionService._buildCacheKeys(id, id, { bridges: [], versions: [] }, []));
      deleteInCache(keys_to_delete);
    }
    return { success: true, api_data: updatedApi };
  } else {
    // Create new
    updateData.bridge_ids = bridge_ids;
    const newApi = await apiCallModel.create(updateData);
    return { success: true, api_data: newApi.toObject() };
  }
}

export default {
  getAllApiCallsByOrgId,
  updateApiCallByFunctionId,
  getFunctionById,
  deleteFunctionFromApicallsDb,
  createApiCall,
  getApiData,
  saveApi
};
