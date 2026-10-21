import PlatformApiKeyModel from "../mongoModel/PlatformApiKey.model.js";
import Helper from "../services/utils/helper.utils.js";
import { getPlatformKeyUsage, getPlatformKeyCostByAgent } from "../db_services/platformKeyUsage.service.js";

// Admin management of the platform's own provider keys. Stored encrypted,
// only ever returned masked, and picked up live by gtwy-ai.

// Store or replace the platform key for one service.
const setPlatformApiKey = async (req, res, next) => {
  const { service, apikey } = req.body;

  const encrypted = await Helper.encrypt(apikey);
  const doc = await PlatformApiKeyModel.findOneAndUpdate(
    { service: String(service) },
    { $set: { apikey: encrypted, updated_by: req.profile?.user?.email || "" } },
    { upsert: true, new: true }
  );

  res.locals = {
    success: true,
    message: "platform api key saved",
    data: {
      service: doc.service,
      apikey: Helper.maskApiKey(apikey),
      updated_at: doc.updated_at
    }
  };
  req.statusCode = 200;
  return next();
};

// Every platform key, masked.
const listPlatformApiKeys = async (req, res, next) => {
  const docs = await PlatformApiKeyModel.find({});
  const data = await Promise.all(
    docs.map(async (doc) => {
      let masked = "";
      try {
        masked = Helper.maskApiKey(await Helper.decrypt(doc.apikey));
      } catch {
        masked = "<undecryptable>";
      }
      return { service: doc.service, apikey: masked, updated_by: doc.updated_by, updated_at: doc.updated_at };
    })
  );

  res.locals = { success: true, data };
  req.statusCode = 200;
  return next();
};

// Remove the platform key for one service.
const removePlatformApiKey = async (req, res, next) => {
  const { service } = req.body;
  await PlatformApiKeyModel.deleteOne({ service: String(service) });

  res.locals = { success: true, message: "platform api key removed" };
  req.statusCode = 200;
  return next();
};

// Per-service / per-org / per-agent usage of the platform's shared keys.
// apikey_id IS NULL in raw_data is the platform-key signal; BYOK rows carry
// the org's ApikeyCredentials ObjectId.
const platformApiKeyUsage = async (req, res, next) => {
  const { days, group_by, service, limit, mode, sources } = req.query;
  const data = await getPlatformKeyUsage({
    days: days ? Number(days) : undefined,
    groupBy: group_by,
    service: service || null,
    limit: limit ? Number(limit) : undefined,
    mode: mode || "combined",
    sources: sources || "both"
  });

  res.locals = { success: true, data };
  req.statusCode = 200;
  return next();
};

// Platform-key cost per agent (bridge_id). Flat list — just agent + cost.
const platformApiKeyCostByAgent = async (req, res, next) => {
  const { days, service, limit } = req.query;
  const data = await getPlatformKeyCostByAgent({
    days: days ? Number(days) : undefined,
    service: service || null,
    limit: limit ? Number(limit) : undefined
  });

  res.locals = { success: true, data };
  req.statusCode = 200;
  return next();
};

export default { setPlatformApiKey, listPlatformApiKeys, removePlatformApiKey, platformApiKeyUsage, platformApiKeyCostByAgent };
