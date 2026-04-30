import { deleteInCache, findInCache, scanCacheKeys } from "../cache_service/index.js";
import { AI_OPERATION_CONFIG } from "../configs/constant.js";
import { executeAiOperation } from "../services/utils/utility.service.js";
import { getKnowledgeBaseToken } from "./rag.controller.js";
import { createOrgToken } from "./chatBot.controller.js";
import embedController from "./embed.controller.js";
import { getUsers } from "../services/proxy.service.js";
import modelConfigDbService from "../db_services/modelConfig.service.js";

const clearRedisCache = async (req, res, next) => {
  const { id, ids } = req.body;

  // Handle single id or array of ids
  if (id || ids) {
    const identifiers = ids ? ids : id;
    await deleteInCache(identifiers);

    const clearedKeys = Array.isArray(identifiers) ? identifiers : [identifiers];
    const message = clearedKeys.length > 1 ? `Redis Keys cleared successfully (${clearedKeys.length} keys)` : "Redis Key cleared successfully";

    res.locals = { message, cleared_keys: clearedKeys, count: clearedKeys.length };
    req.statusCode = 200;
    return next();
  } else {
    // Clear all keys except protected patterns
    const protectedPatterns = ["bridgeusedcost_", "folderusedcost_", "apikeyusedcost_", "blacklist:"];

    const keys = await scanCacheKeys("*");
    const keysToDelete = keys.filter((key) => {
      return !protectedPatterns.some((pattern) => key.includes(pattern));
    });
    const skippedKeys = keys.filter((key) => {
      return protectedPatterns.some((pattern) => key.includes(pattern));
    });

    if (keysToDelete && keysToDelete.length > 0) {
      await deleteInCache(keysToDelete);
    }

    res.locals = {
      message: "Redis cleared successfully",
      cleared_keys: keysToDelete,
      skipped_keys: skippedKeys,
      count: keysToDelete.length
    };
    req.statusCode = 200;
    return next();
  }
};

const getRedisCache = async (req, res, next) => {
  const { id } = req.params;
  const result = await findInCache(id);
  res.locals = result;
  req.statusCode = 200;
  return next();
};

const callGtwy = async (req, res, next) => {
  const { type } = req.body;
  const org_id = req.profile?.org?.id;

  const config = AI_OPERATION_CONFIG[type];

  if (!config) {
    res.locals = { success: false, message: "Invalid type" };
    req.statusCode = 400;
    return next();
  }

  const result = await executeAiOperation(req, org_id, config);

  res.locals = result;
  req.statusCode = 200;
  return next();
};

const generateToken = async (req, res, next) => {
  const { type } = req.body;

  // Route to appropriate token generation function based on type
  switch (type.toLowerCase()) {
    case "rag":
      return getKnowledgeBaseToken(req, res, next);

    case "org":
      return createOrgToken(req, res, next);

    case "embed":
      return embedController.genrateToken(req, res, next);

    case "embed_preview":
      return embedController.genrateToken(req, res, next);

    case "rag_embed_preview":
      return embedController.genrateToken(req, res, next);

    case "chatbot_embed_preview":
      return embedController.genrateToken(req, res, next);

    default:
      res.locals = { success: false, message: `Invalid type: ${type}. Valid types are: rag, org, embed` };
      req.statusCode = 400;
      return next();
  }
};

const getCurrentOrgUsers = async (req, res, next) => {
  const org_id = req.profile?.org?.id;

  if (!org_id) {
    res.locals = { success: false, message: "Organization ID not found" };
    req.statusCode = 400;
    return next();
  }

  // Fetch all users from the organization
  let allUsers = [];
  let page = 1;
  let hasMoreData = true;

  while (hasMoreData) {
    const userResp = await getUsers(org_id, page, 50);

    if (userResp && Array.isArray(userResp.data)) {
      allUsers = [...allUsers, ...userResp.data];
      hasMoreData = userResp?.totalEntityCount > allUsers.length;
    } else {
      hasMoreData = false;
    }
    page++;
  }

  // Extract only name, email, and user_id
  const users = allUsers.map((user) => ({
    user_id: user.id || null,
    name: user.name || null,
    email: user.email || null
  }));

  res.locals = { data: users, success: true };
  req.statusCode = 200;
  return next();
};

const getAffiliateEmbedToken = async (req, res, next) => {
  const orgToken = process.env.AFFILIATE_ORG_TOKEN;
  if (!orgToken) {
    res.locals = { success: false, message: "AFFILIATE_ORG_TOKEN is not configured" };
    req.statusCode = 500;
    return next();
  }

  const { organization, expires_in_hours, label } = req.body;

  const response = await fetch("https://apireftest.hostnsoft.com/api/v1/embed/token/generate", {
    method: "POST",
    headers: {
      "X-Org-Token": orgToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ organization, expires_in_hours, label })
  });

  const data = await response.json();

  res.locals = data;
  req.statusCode = response.status;
  return next();
};

const setModelStatus = async (req, res, next) => {
  const { model_name, service, status: parsedStatus } = req.body;

  const existing = await modelConfigDbService.getModelConfigsByNameAndService(model_name, service);

  if (!existing || existing.length === 0) {
    res.locals = { success: false, message: "Model configuration not found." };
    req.statusCode = 404;
    return next();
  }

  if (existing[0].status === parsedStatus) {
    const state = parsedStatus === 0 ? "already disabled" : "already enabled";
    res.locals = { success: false, message: `Model '${model_name}' for service '${service}' is ${state}.` };
    req.statusCode = 409;
    return next();
  }

  const result = await modelConfigDbService.setModelStatusAdmin(model_name, service, parsedStatus);

  const action = parsedStatus === 0 ? "disabled" : "enabled";
  const response = {
    success: true,
    message: `Model '${model_name}' for service '${service}' has been ${action}.`,
    modelConfig: result.modelConfig
  };

  if (parsedStatus === 0) {
    if (result.usageInfo) {
      response.usageInfo = result.usageInfo;
    }
    response.updatedVersions = result.updatedVersions;
    if (result.updatedVersions && result.updatedVersions.length > 0) {
      response.message += ` Updated ${result.updatedVersions.length} agent version(s) to use default model.`;
    }
  }

  res.locals = response;
  req.statusCode = 200;
  return next();
};

export default {
  clearRedisCache,
  getRedisCache,
  callGtwy,
  generateToken,
  getCurrentOrgUsers,
  getAffiliateEmbedToken,
  setModelStatus
};
