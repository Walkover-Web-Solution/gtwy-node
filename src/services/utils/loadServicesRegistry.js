import ServiceModel from "../../mongoModel/Service.model.js";

// In-memory registry of the `services` collection, keyed by service_name.
// Refreshed at boot and on every change-stream event. Mirrors the pattern in
// loadModelConfigs.js.
let servicesRegistry = {};

const getServicesRegistry = async () => {
  try {
    const services = await ServiceModel.find({ status: 1 }).lean();
    const formatted = {};
    for (const svc of services) {
      if (svc.service_name) formatted[svc.service_name] = svc;
    }
    return formatted;
  } catch (error) {
    console.error("Error fetching service registry:", error);
    return {};
  }
};

const initServicesRegistry = async () => {
  try {
    const newDocument = await getServicesRegistry();
    for (const key in servicesRegistry) {
      delete servicesRegistry[key];
    }
    Object.assign(servicesRegistry, newDocument);
    console.log(`Service registry refreshed successfully (${Object.keys(servicesRegistry).length} services).`);
  } catch (error) {
    console.error("Error refreshing service registry:", error);
  }
};

const backgroundListenForServiceChanges = async () => {
  try {
    const stream = ServiceModel.watch([{ $match: { operationType: { $in: ["insert", "update", "replace", "delete"] } } }]);

    console.log("MongoDB change stream is now listening for service registry changes.");

    stream.on("change", async (change) => {
      console.log(`Change detected in service registry: ${change.operationType}`);
      await initServicesRegistry();
    });

    stream.on("error", (error) => {
      console.error("Service registry change stream error:", error);
      setTimeout(backgroundListenForServiceChanges, 5000);
    });
  } catch (error) {
    console.error("Error initializing service registry change stream:", error);
    setTimeout(backgroundListenForServiceChanges, 10000);
  }
};

// --- Lookup helpers (live DB only) ----------------------------------------
const getService = (name) => {
  return servicesRegistry[name] || null;
};

const field = (name, key, defaultValue = null) => {
  const svc = getService(name);
  if (!svc) return defaultValue;
  const value = svc[key];
  return value === null || value === undefined ? defaultValue : value;
};

const wireFormat = (name) => field(name, "wire_format");
const client = (name) => field(name, "client");
const getBaseUrl = (name) => field(name, "base_url");
const getDefaultModel = (name) => field(name, "default_model");
const apikeyStatusCodes = (name) => field(name, "apikey_status_codes", {});
const getValidationConfig = (name) => field(name, "validation_config", {});

// --- Capability predicates (mirror the Python registry) --------------------
const usesOpenAISdk = (name) => client(name) === "openai_sdk" && wireFormat(name) === "openai_chat";
const hasOpenAIChoicesShape = (name) => wireFormat(name) === "openai_chat";

// Get all service names from the registry (for dynamic Joi validation)
const getServiceNames = () => Object.keys(servicesRegistry);

export {
  servicesRegistry,
  initServicesRegistry,
  backgroundListenForServiceChanges,
  getService,
  wireFormat,
  client,
  getBaseUrl,
  getDefaultModel,
  apikeyStatusCodes,
  getValidationConfig,
  usesOpenAISdk,
  hasOpenAIChoicesShape,
  getServiceNames
};
