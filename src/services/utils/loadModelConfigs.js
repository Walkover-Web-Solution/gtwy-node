import ModelsConfigModel from "../../mongoModel/ModelConfig.model.js";

let modelConfigDocument = {};

function createdAtMs(config) {
  if (!config?.created_at) return 0;
  const ms = new Date(config.created_at).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** Rebuild a service's model map so Object key order is newest created_at first. */
function reorderServiceModels(serviceMap) {
  if (!serviceMap) return;
  const entries = Object.entries(serviceMap).sort(([, a], [, b]) => createdAtMs(b) - createdAtMs(a));
  for (const key of Object.keys(serviceMap)) delete serviceMap[key];
  for (const [modelName, config] of entries) {
    serviceMap[modelName] = config;
  }
}

function removeModelFromCache(service, modelName) {
  if (!service || !modelName) return;
  const serviceKey = String(service).toLowerCase();
  const serviceMap = modelConfigDocument[serviceKey];
  if (!serviceMap) return;
  delete serviceMap[modelName];
  if (Object.keys(serviceMap).length === 0) {
    delete modelConfigDocument[serviceKey];
  }
}

/**
 * Apply a single Mongo change-stream event to the in-memory cache
 * without reloading the full collection.
 */
function applyModelConfigChange(change) {
  const op = change?.operationType;
  const doc = change?.fullDocument;
  const before = change?.fullDocumentBeforeChange;

  if (op === "delete") {
    const src = before || {};
    removeModelFromCache(src.service, src.model_name);
    return;
  }

  if (!doc || !doc.service || !doc.model_name) {
    // Fallback if payload is incomplete
    return false;
  }

  // Service / model_name rename: drop the old key first.
  if (before?.service && before?.model_name) {
    const oldService = String(before.service).toLowerCase();
    const newService = String(doc.service).toLowerCase();
    if (oldService !== newService || before.model_name !== doc.model_name) {
      removeModelFromCache(before.service, before.model_name);
    }
  }

  const serviceKey = String(doc.service).toLowerCase();
  if (!modelConfigDocument[serviceKey]) {
    modelConfigDocument[serviceKey] = {};
  }
  modelConfigDocument[serviceKey][doc.model_name] = doc;
  reorderServiceModels(modelConfigDocument[serviceKey]);
  return true;
}

const getModelConfigurations = async () => {
  try {
    // Newest first so in-memory object key order (and API response) stays date-sorted.
    const configs = await ModelsConfigModel.find({}).sort({ created_at: -1 }).lean();
    const formattedConfigs = {};

    for (const config of configs) {
      const service = config.service.toLowerCase();
      if (!formattedConfigs[service]) {
        formattedConfigs[service] = {};
      }
      formattedConfigs[service][config.model_name] = config;
    }
    return formattedConfigs;
  } catch (error) {
    console.error("Error fetching model configurations:", error);
    return {};
  }
};

const initModelConfiguration = async () => {
  try {
    const newDocument = await getModelConfigurations();
    // Clear existing keys
    for (const key in modelConfigDocument) {
      delete modelConfigDocument[key];
    }
    // Update with new data
    Object.assign(modelConfigDocument, newDocument);
    console.log("Model configurations refreshed successfully.");
  } catch (error) {
    console.error("Error refreshing model configurations:", error);
  }
};

const backgroundListenForChanges = async () => {
  try {
    const stream = ModelsConfigModel.watch([{ $match: { operationType: { $in: ["insert", "update", "replace", "delete"] } } }], {
      fullDocument: "updateLookup",
      fullDocumentBeforeChange: "whenAvailable"
    });

    console.log("MongoDB change stream is now listening for model configuration changes.");

    stream.on("change", async (change) => {
      console.log(`Change detected in model configurations: ${change.operationType}`);
      try {
        const applied = applyModelConfigChange(change);
        // If we couldn't apply (e.g. missing before-image on delete), do a full refresh.
        if (applied === false) {
          await initModelConfiguration();
        }
      } catch (err) {
        console.error("Error applying model config change; falling back to full refresh:", err);
        await initModelConfiguration();
      }
    });

    stream.on("error", (error) => {
      console.error("Change stream error:", error);
      // Retry logic could be added here if needed, but stream might close on error
      setTimeout(backgroundListenForChanges, 5000);
    });
  } catch (error) {
    console.error("Error initializing change stream:", error);
    setTimeout(backgroundListenForChanges, 10000);
  }
};

export { modelConfigDocument, initModelConfiguration, backgroundListenForChanges, applyModelConfigChange, reorderServiceModels };
