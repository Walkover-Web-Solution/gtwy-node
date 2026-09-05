import ModelsConfigModel from "../../mongoModel/ModelConfig.model.js";

let modelConfigDocument = {};

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
    const stream = ModelsConfigModel.watch([{ $match: { operationType: { $in: ["insert", "update", "replace", "delete"] } } }]);

    console.log("MongoDB change stream is now listening for model configuration changes.");

    stream.on("change", async (change) => {
      console.log(`Change detected in model configurations: ${change.operationType}`);
      await initModelConfiguration();
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

export { modelConfigDocument, initModelConfiguration, backgroundListenForChanges };
