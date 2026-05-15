import ModelsConfigModel from "../mongoModel/ModelConfig.model.js";
import { flatten } from "flat";
import ConfigurationServices from "./configuration.service.js";
import configurationModel from "../mongoModel/Configuration.model.js";
import versionModel from "../mongoModel/BridgeVersion.model.js";
import { new_agent_service } from "../configs/constant.js";
import { normalizeBulkModelConfigChange, normalizeBulkModelConfigFilter } from "../utils/modelConfigUpdate.utils.js";

async function checkModel(model_name, service) {
  //function to check if a model configuration exists
  const existingConfig = await ModelsConfigModel.findOne({ model_name, service });
  if (!existingConfig) {
    return false;
  }
  return true;
}

async function checkModelConfigExists(service, model_name) {
  const query = { service, model_name };

  const existingConfig = await ModelsConfigModel.findOne(query).lean();
  return existingConfig ? true : false;
}

async function getAllModelConfigsForService(service) {
  const modelConfigs = await ModelsConfigModel.find({ service: service }).lean();
  return modelConfigs.map((mc) => ({ ...mc, _id: mc._id.toString() }));
}

async function getAllModelConfigs() {
  const modelConfigs = await ModelsConfigModel.find().lean();
  return modelConfigs.map((mc) => ({ ...mc, _id: mc._id.toString() }));
}

async function saveModelConfig(modelConfigData) {
  const newModelConfig = new ModelsConfigModel(modelConfigData);
  const result = await newModelConfig.save();
  return { id: result._id.toString(), ...modelConfigData };
}

async function setModelStatusAdmin(model_name, service, status, org_id) {
  const query = { model_name, service };
  if (org_id) query.org_id = org_id;

  const update = { $set: { status } };
  if (status === 0) {
    update.$set.disabled_at = new Date();
  } else {
    update.$set.disabled_at = null;
  }

  const result = await ModelsConfigModel.findOneAndUpdate(query, update, { new: true });
  // If disabling the model, find all agents and versions using it and replace with default model
  let usageInfo = null;
  let updatedVersions = new Set();
  if (status === 0 && result) {
    usageInfo = await ConfigurationServices.findIdsByModelAndService(model_name, service, null);

    const defaultModel = new_agent_service[service]?.model;
    if (defaultModel && usageInfo?.data) {
      const versionIds = usageInfo.data.versions.map((v) => v.id);
      if (versionIds.length > 0) {
        // Update primary model in versions
        await versionModel.updateMany(
          { _id: { $in: versionIds }, "configuration.model": model_name },
          { $set: { "configuration.model": defaultModel } }
        );
        // Update fallback model in versions
        await versionModel.updateMany(
          { _id: { $in: versionIds }, "settings.fall_back.model": model_name },
          { $set: { "settings.fall_back.model": defaultModel } }
        );
        versionIds.forEach((id) => updatedVersions.add(id));
      }

      const agentIds = usageInfo.data.agents.map((a) => a.id);
      if (agentIds.length > 0) {
        // Update primary model in agents
        await configurationModel.updateMany(
          { _id: { $in: agentIds }, "configuration.model": model_name },
          { $set: { "configuration.model": defaultModel } }
        );
        // Update fallback model in agents
        await configurationModel.updateMany(
          { _id: { $in: agentIds }, "settings.fall_back.model": model_name },
          { $set: { "settings.fall_back.model": defaultModel } }
        );
      }
    }
  }

  return {
    modelConfig: result,
    usageInfo: usageInfo,
    updatedVersions: Array.from(updatedVersions)
  };
}

async function deleteModelConfig(model_name, service) {
  const result = await ModelsConfigModel.findOneAndDelete({ model_name, service });
  return result;
}

async function deleteUserModelConfig(model_name, service, org_id) {
  const result = await ModelsConfigModel.findOneAndDelete({ model_name, service, org_id });
  return result;
}

async function getModelConfigsByNameAndService(model_name, service) {
  const modelConfigs = await ModelsConfigModel.find({ model_name, service }).lean();
  return modelConfigs.map((mc) => ({ ...mc, _id: mc._id.toString() }));
}

async function updateModelConfigs(model_name, service, updates) {
  //function to update provided model parameters

  const allowedUpdates = {};
  let errorKey = "";

  // Flatten nested objects into dot notation
  const flattenedUpdates = flatten(updates, { safe: true });

  for (const key in flattenedUpdates) {
    // Block configuration.model and its subfields, and only allow changes for configuration and validationConfig
    const isBlockedModelField = key === "configuration.model" || key.startsWith("configuration.model.");
    const isAllowedRoot = key.startsWith("configuration.") || key.startsWith("validationConfig.");

    if (isBlockedModelField || !isAllowedRoot) {
      errorKey = key;
      continue;
    }
    // Allow everything else
    allowedUpdates[key] = flattenedUpdates[key];
  }

  // No valid updates to perform
  if (Object.keys(allowedUpdates).length === 0) {
    return { error: "keyError", key: errorKey };
  }

  // First, get the existing document to check which keys exist
  const existingDoc = await ModelsConfigModel.findOne(
    { model_name, service },
    { _id: 0, __v: 0 } // Exclude _id and __v fields
  );

  if (!existingDoc) {
    return { error: "documentNotFound" };
  }

  // Flatten the existing document to match the structure of allowedUpdates
  // Convert to plain object to avoid Mongoose document issues
  const plainDoc = existingDoc.toObject ? existingDoc.toObject() : existingDoc;
  const flattenedExistingDoc = flatten(plainDoc, { safe: true });

  // Filter allowedUpdates to only include keys that exist in the document
  const existingKeyUpdates = {};
  for (const key in allowedUpdates) {
    if (flattenedExistingDoc.hasOwnProperty(key)) {
      existingKeyUpdates[key] = allowedUpdates[key];
    }
  }

  // If no existing keys to update, return early
  if (Object.keys(existingKeyUpdates).length === 0) {
    return { error: "not found" };
  }

  const result = await ModelsConfigModel.updateOne({ model_name, service }, { $set: existingKeyUpdates }, { strict: false });

  return result.modifiedCount > 0;
}

async function bulkUpdateModelConfigs({ models, filter, change, org_id }) {
  const uniqueModels = models ? [...new Map(models.map((model) => [model.model_name, model])).values()] : [];

  if (!filter && uniqueModels.length === 0) {
    return { error: "documentNotFound" };
  }

  const normalizedChange = normalizeBulkModelConfigChange(change);
  if (normalizedChange.error) {
    return normalizedChange;
  }

  const normalizedFilter = normalizeBulkModelConfigFilter(filter);
  if (normalizedFilter.error) {
    return normalizedFilter;
  }

  const query = { ...normalizedFilter.filterQuery };

  if (!query.model_name && uniqueModels.length > 0) {
    query.model_name = { $in: uniqueModels.map((model) => model.model_name) };
  }

  if (org_id) {
    query.org_id = org_id;
  }

  const existingModels = await ModelsConfigModel.find(query, { _id: 0, service: 1, model_name: 1 }).lean();

  if (existingModels.length === 0) {
    return { error: "documentNotFound" };
  }

  const result = await ModelsConfigModel.updateMany(query, normalizedChange.updateDocument, { strict: false });
  const foundModelNames = new Set(existingModels.map((model) => model.model_name));
  const notFoundModels = uniqueModels.filter((model) => !foundModelNames.has(model.model_name));

  return {
    requestedCount: uniqueModels.length,
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    updatedModels: existingModels,
    notFoundModels
  };
}

export default {
  getAllModelConfigs,
  saveModelConfig,
  getAllModelConfigsForService,
  deleteModelConfig,
  deleteUserModelConfig,
  setModelStatusAdmin,
  checkModelConfigExists,
  getModelConfigsByNameAndService,
  checkModel,
  updateModelConfigs,
  bulkUpdateModelConfigs
};
