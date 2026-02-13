import ApikeyCredential from "../mongoModel/Api.model.js";
import versionModel from "../mongoModel/BridgeVersion.model.js";
import configurationModel from "../mongoModel/Configuration.model.js";
import FolderModel from "../mongoModel/GtwyEmbed.model.js";

const saveApikeyRecord = async (data) => {
  const { org_id, apikey, service, name, comment, folder_id, user_id, apikey_limit = 0, apikey_limit_reset_period, apikey_limit_start_date } = data;
  const version_ids = [];
  const result = await new ApikeyCredential({
    org_id,
    apikey,
    service,
    name,
    comment,
    folder_id,
    user_id,
    version_ids,
    apikey_limit,
    apikey_limit_reset_period,
    apikey_limit_start_date
  }).save();

  return {
    success: true,
    api: result
  };
};

const findApikeyByName = async (name, org_id) => {
  try {
    const result = await ApikeyCredential.findOne({
      org_id: org_id,
      name: name
    });

    return {
      success: true,
      result: result
    };
  } catch (error) {
    console.error("Error getting API: ", error);
    return {
      success: false,
      error: error.message
    };
  }
};
const findAllApikeys = async (org_id, folder_id, user_id, isEmbedUser) => {
  try {
    const query = { org_id: org_id };

    if (folder_id) {
      query.folder_id = folder_id;
    } else {
      query.$or = [{ folder_id: "" }, { folder_id: null }, { folder_id: { $exists: false } }];
    }
    if (user_id && isEmbedUser) query.user_id = String(user_id);

    const result = await ApikeyCredential.find(query);
    return {
      success: true,
      result: result
    };
  } catch (error) {
    console.error("Error getting all API: ", error);
    return {
      success: false,
      error: error.message
    };
  }
};

async function updateApikeyRecord(
  apikey_object_id,
  apikey = null,
  name = null,
  service = null,
  comment = null,
  apikey_limit = 0,
  apikey_usage = -1,
  apikey_limit_reset_period = null,
  apikey_limit_start_date = null
) {
  try {
    const updateFields = {};

    if (apikey) {
      updateFields.apikey = apikey;
    }
    if (name) {
      updateFields.name = name;
    }
    if (service) {
      updateFields.service = service;
    }
    if (comment) {
      updateFields.comment = comment;
    }
    if (apikey_limit >= 0) {
      updateFields.apikey_limit = apikey_limit;
    }
    if (apikey_usage == 0) {
      updateFields.apikey_usage = 0;
    }
    if (apikey_limit_reset_period) {
      updateFields.apikey_limit_reset_period = apikey_limit_reset_period;
    }
    if (apikey_limit_start_date) {
      updateFields.apikey_limit_start_date = apikey_limit_start_date;
    }

    let apikeyCredentialResult;

    if (Object.keys(updateFields).length > 0) {
      apikeyCredentialResult = await ApikeyCredential.findOneAndUpdate({ _id: apikey_object_id }, { $set: updateFields }, { new: true }).lean();
    }

    if (!apikeyCredentialResult) {
      return {
        success: false,
        error: "No records updated or bridge not found"
      };
    }

    return {
      success: true,
      apikey: apikey || updateFields.apikey,
      updatedData: apikeyCredentialResult
    };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      error: "Something went wrong!"
    };
  }
}

async function removeApikeyFromEmbeds(apikey_object_id, org_id) {
  try {
    const apiKeyData = await findApikeyById(apikey_object_id);
    if (!apiKeyData || !apiKeyData.service) {
      return { success: false, error: "API key data or service not found" };
    }

    const service = apiKeyData.service;
    const query = {
      org_id: org_id,
      [`apikey_object_id.${service}`]: apikey_object_id
    };

    const updateResult = await FolderModel.updateMany(query, { $unset: { [`apikey_object_id.${service}`]: "" } });

    return {
      success: true,
      cleanedCount: updateResult.modifiedCount,
      message: `Cleaned up API key reference from ${updateResult.modifiedCount} embed(s)`
    };
  } catch (error) {
    console.error(`Error cleaning up embeds: ${error}`);
    return {
      success: false,
      error: error.message
    };
  }
}

async function removeApikeyById(apikey_object_id, org_id) {
  try {
    await removeApikeyFromEmbeds(apikey_object_id, org_id);

    const result = await ApikeyCredential.deleteOne({ _id: apikey_object_id });
    if (result.deletedCount > 0) {
      return { success: true };
    } else {
      return {
        success: false,
        error: "API key not found"
      };
    }
  } catch (error) {
    console.error(`Error: ${error}`);
    return {
      success: false,
      error: error.message
    };
  }
}

async function findApikeyById(apikey_object_id) {
  try {
    const result = await ApikeyCredential.findOne({ _id: apikey_object_id });
    const resultObject = result.toObject();
    return resultObject;
  } catch (error) {
    console.error("Error getting API data: ", error);
    return {
      success: false,
      error: error
    };
  }
}

async function findVersionsByIds(versionIds, service) {
  if (!versionIds?.length) {
    return {
      success: false,
      message: "No version IDs provided"
    };
  }

  try {
    // First, fetch all version documents to get their parent_ids (only fetch parent_id field)
    const versionDocs = await versionModel.find({ _id: { $in: versionIds } }, { parent_id: 1 }).lean();

    // Extract unique parent_ids from version documents
    const parentIds = [...new Set(versionDocs.filter((doc) => doc.parent_id).map((doc) => doc.parent_id))];

    // Process version documents using bulkWrite
    const versionResult = await processBulkUpdates(versionModel, versionIds, service);

    // Process parent documents using bulkWrite if any exist
    const configResult = parentIds.length > 0 ? await processBulkUpdates(configurationModel, parentIds, service) : { modifiedCount: 0 };

    return {
      success: true,
      modifiedCount: versionResult.modifiedCount + configResult.modifiedCount,
      versionModifiedCount: versionResult.modifiedCount,
      parentModifiedCount: configResult.modifiedCount
    };
  } catch (error) {
    console.error("Error updating versions and parents:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Helper function to process bulk updates for a collection
 * @param {Object} model - Mongoose model to update
 * @param {Array} ids - Array of document IDs to update
 * @param {String} service - Service name to unset in apikey_object_id
 * @returns {Object} Result with modifiedCount
 */
async function processBulkUpdates(model, ids, service) {
  if (!ids.length) return { modifiedCount: 0 };

  try {
    // Create bulk operations
    const bulkOps = ids.map((id) => ({
      updateOne: {
        filter: { _id: id },
        update: { $unset: { [`apikey_object_id.${service}`]: "" } }
      }
    }));

    // Execute bulk operations
    const bulkResult = await model.bulkWrite(bulkOps);

    // Log results for debugging
    console.log(
      `Bulk update results for ${model.modelName}:`,
      JSON.stringify({
        matchedCount: bulkResult.matchedCount,
        modifiedCount: bulkResult.modifiedCount
      })
    );

    return { modifiedCount: bulkResult.modifiedCount };
  } catch (error) {
    console.error(`Error in bulk update for ${model.modelName}:`, error);
    return { modifiedCount: 0 };
  }
}

export default {
  saveApikeyRecord,
  findApikeyByName,
  findAllApikeys,
  updateApikeyRecord,
  removeApikeyById,
  findApikeyById,
  findVersionsByIds,
  removeApikeyFromEmbeds
};
