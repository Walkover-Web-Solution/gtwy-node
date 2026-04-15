import ModelsConfigModel from "../mongoModel/ModelConfig.model.js";
import { flatten } from "flat";

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
  return result;
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
  updateModelConfigs
};
