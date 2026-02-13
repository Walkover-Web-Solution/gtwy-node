import apikeyService from "../db_services/apikey.service.js";
import Helper from "../services/utils/helper.utils.js";
import { findInCache, deleteInCache } from "../cache_service/index.js";
import {
  callOpenAIModelsApi,
  callGroqApi,
  callAnthropicApi,
  callOpenRouterApi,
  callMistralApi,
  callGeminiApi,
  callAiMlApi,
  callGrokApi
} from "../services/utils/aiServices.js";
import { redis_keys, cost_types, new_agent_service } from "../configs/constant.js";
import { cleanupCache } from "../services/utils/redis.utils.js";

const saveApikey = async (req, res, next) => {
  const { service, name, comment, apikey_limit = 0, apikey_limit_reset_period, apikey_limit_start_date } = req.body;
  const org_id = req.profile?.org?.id;
  const folder_id = req.profile?.extraDetails?.folder_id;
  const user_id = req.profile.user.id;
  let apikey = req.body.apikey;

  // Check API key validity
  await checkApikey(apikey, service);

  // Encrypt API key
  apikey = await Helper.encrypt(apikey);
  const result = await apikeyService.saveApikeyRecord({
    org_id,
    apikey,
    service,
    name,
    comment,
    folder_id,
    user_id,
    apikey_limit,
    apikey_limit_reset_period,
    apikey_limit_start_date
  });

  // Mask API key for response
  const decryptedApiKey = await Helper.decrypt(apikey);
  const maskedApiKey = await Helper.maskApiKey(decryptedApiKey);
  result.api.apikey = maskedApiKey;

  if (result.success) {
    res.locals = result;
    req.statusCode = 200;
    return next();
  } else {
    res.locals = {
      success: false,
      error: result.error
    };
    req.statusCode = 400;
    return next();
  }
};

const getAllApikeys = async (req, res, next) => {
  const org_id = req.profile?.org?.id;
  const folder_id = req.profile?.extraDetails?.folder_id;
  const user_id = req.profile.user.id;
  const isEmbedUser = req.IsEmbedUser;

  const result = await apikeyService.findAllApikeys(org_id, folder_id, user_id, isEmbedUser);

  if (result.success) {
    // Process all API keys in parallel for better performance
    const processedResults = await Promise.all(
      result.result.map(async (apiKeyObj) => {
        // Convert Mongoose document to plain object
        const plainObj = apiKeyObj.toObject ? apiKeyObj.toObject() : apiKeyObj;

        // Decrypt and mask the API key
        const decryptedApiKey = await Helper.decrypt(plainObj.apikey);
        const maskedApiKey = await Helper.maskApiKey(decryptedApiKey);

        // Get last used data from cache (runs in parallel)
        const lastUsedData = await findInCache(`${redis_keys.apikeylastused_}${plainObj._id}`);
        const cachedVal = await findInCache(`${redis_keys.apikeyusedcost_}${apiKeyObj._id}`);

        // Create the final object with all properties
        const processedObj = {
          ...plainObj,
          apikey: maskedApiKey
        };

        // Only add last_used if cache data exists
        if (lastUsedData) {
          processedObj.last_used = JSON.parse(lastUsedData);
        }

        if (cachedVal) {
          let usagecost = JSON.parse(cachedVal);
          processedObj.apikey_usage = usagecost?.usage_value;
        }

        return processedObj;
      })
    );

    // Update the result with processed data
    result.result = processedResults;
    res.locals = result;
    req.statusCode = 200;
    return next();
  } else {
    res.locals = {
      success: false,
      error: result.error
    };
    req.statusCode = 400;
    return next();
  }
};

const updateApikey = async (req, res, next) => {
  let apikey = req.body.apikey;
  const { name, comment, service, apikey_limit = 0, apikey_usage = -1, apikey_limit_reset_period, apikey_limit_start_date } = req.body;
  const { apikey_id: apikey_object_id } = req.params;

  // Check API key validity if provided
  if (apikey) {
    await checkApikey(apikey, service);
    apikey = await Helper.encrypt(apikey);
  }

  const result = await apikeyService.updateApikeyRecord(
    apikey_object_id,
    apikey,
    name,
    service,
    comment,
    apikey_limit,
    apikey_usage,
    apikey_limit_reset_period,
    apikey_limit_start_date
  );

  // Mask API key for response if updated
  let decryptedApiKey, maskedApiKey;
  if (apikey) {
    decryptedApiKey = await Helper.decrypt(apikey);
    maskedApiKey = await Helper.maskApiKey(decryptedApiKey);
    result.apikey = maskedApiKey;
  }

  if (result.success) {
    // Clean up cache using the universal Redis utility for cost
    await cleanupCache(cost_types.apikey, apikey_object_id);
    if (apikey_usage == 0) {
      await deleteInCache(`${redis_keys.apikeyusedcost_}${apikey_object_id}`);
    }
    res.locals = {
      success: true,
      message: "Apikey updated successfully",
      apikey: result?.apikey
    };
    req.statusCode = 200;
    return next();
  } else {
    res.locals = {
      success: false,
      message: "No records updated or bridge not found"
    };
    req.statusCode = 400;
    return next();
  }
};

const deleteApikey = async (req, res, next) => {
  const { apikey_object_id } = req.body;
  const org_id = req.profile.org.id;

  const apikeys_data = await apikeyService.findApikeyById(apikey_object_id);
  let version_ids = apikeys_data?.version_ids || [];
  const service = apikeys_data?.service;
  await apikeyService.findVersionsByIds(version_ids, service);
  const result = await apikeyService.removeApikeyById(apikey_object_id, org_id);

  if (result.success) {
    await cleanupCache(cost_types.apikey, apikey_object_id);
    res.locals = {
      success: true,
      message: "Apikey deleted successfully"
    };
    req.statusCode = 200;
    return next();
  } else {
    res.locals = {
      success: false,
      message: result.error
    };
    req.statusCode = 400;
    return next();
  }
};

const checkApikey = async (apikey, service) => {
  let check;
  const model = new_agent_service[service];

  switch (service) {
    case "openai":
      check = await callOpenAIModelsApi(apikey);
      break;
    case "anthropic":
      check = await callAnthropicApi(apikey, model);
      break;
    case "groq":
      check = await callGroqApi(apikey, model);
      break;
    case "open_router":
      check = await callOpenRouterApi(apikey);
      break;
    case "mistral":
      check = await callMistralApi(apikey, model);
      break;
    case "gemini":
      check = await callGeminiApi(apikey, model);
      break;
    case "ai_ml":
      check = await callAiMlApi(apikey, model);
      break;
    case "grok":
      check = await callGrokApi(apikey);
      break;
    default:
      const error = new Error("Invalid service provided");
      error.statusCode = 400;
      throw error;
  }

  if (!check.success) {
    const error = new Error("invalid apikey or apikey is expired");
    error.statusCode = 400;
    throw error;
  }
  return check.data;
};

export default {
  saveApikey,
  getAllApikeys,
  deleteApikey,
  updateApikey
};
