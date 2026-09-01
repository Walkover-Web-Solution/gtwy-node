import PlatformApiKeyModel from "../mongoModel/PlatformApiKey.model.js";
import Helper from "../services/utils/helper.utils.js";

// Admin management of the platform's own provider keys (wallet-billed
// traffic). Keys are encrypted with Helper.encrypt — the same method customer
// apikeys use — and only ever returned masked. Python picks changes up
// automatically through its change stream on the collection.

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

const removePlatformApiKey = async (req, res, next) => {
  const { service } = req.body;
  await PlatformApiKeyModel.deleteOne({ service: String(service) });

  res.locals = { success: true, message: "platform api key removed" };
  req.statusCode = 200;
  return next();
};

export default { setPlatformApiKey, listPlatformApiKeys, removePlatformApiKey };
