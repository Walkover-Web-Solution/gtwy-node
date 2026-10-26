import blockedOrgService from "../db_services/blockedOrg.service.js";
import client from "../services/cache.service.js";
import { redis_keys } from "../configs/constant.js";
import { StatusCodes } from "http-status-codes";
import { isInternalUser } from "../middlewares/middleware.js";
import ApiError from "../utils/ApiError.js";

const BLOCKED_ORGS_KEY = `AIMIDDLEWARE_${process.env.ENVIRONMENT}_${redis_keys.blocked_orgs_}`;
// Members are `${org_id}_${user_id}`; gtwy-ai reads the same set.
const BLOCKED_USERS_KEY = `AIMIDDLEWARE_${process.env.ENVIRONMENT}_${redis_keys.blocked_users_}`;

const blockOrg = async (req, res, next) => {
  const { org_id, reason } = req.body;
  const orgId = String(org_id);
  const record = await blockedOrgService.block({ org_id: orgId, reason: reason || null, blocked_by: req.profile?.user?.id });
  if (client.isReady) await client.sAdd(BLOCKED_ORGS_KEY, orgId);
  res.locals = { success: true, message: "Organization blocked successfully", data: record };
  req.statusCode = 200;
  return next();
};

const unblockOrg = async (req, res, next) => {
  const orgId = String(req.params.org_id);
  await blockedOrgService.unblock(orgId);
  if (client.isReady) await client.sRem(BLOCKED_ORGS_KEY, orgId);

  res.locals = { success: true, message: "Organization unblocked successfully" };
  req.statusCode = 200;
  return next();
};

const listBlockedOrgs = async (req, res, next) => {
  const data = await blockedOrgService.getAll();
  res.locals = { success: true, data };
  req.statusCode = 200;
  return next();
};

// User blocks default to the caller's own org (from the pauthkey, proxy token or
// JWT). Only internal staff may name another org through org_id.
const resolveOrgId = (req, requestedOrgId) => {
  const ownOrgId = String(req.profile.org.id);
  if (!requestedOrgId || String(requestedOrgId) === ownOrgId) return ownOrgId;
  if (isInternalUser(req.profile)) return String(requestedOrgId);
  throw new ApiError(StatusCodes.FORBIDDEN, "You can only manage blocked users of your own organization");
};

const blockUser = async (req, res, next) => {
  const { org_id, user_id, reason } = req.body;
  const orgId = resolveOrgId(req, org_id);
  const userId = String(user_id);
  // Throws 404 if the user isn't in this org, 403 if they aren't an embed user,
  // 502 if MSG91 can't be reached
  await blockedOrgService.verifyOrgUser(userId, orgId);
  const record = await blockedOrgService.blockUser({
    org_id: orgId,
    user_id: userId,
    reason: reason || null,
    blocked_by: req.profile?.user?.id
  });
  if (client.isReady) await client.sAdd(BLOCKED_USERS_KEY, `${orgId}_${userId}`);
  res.locals = { success: true, message: "User blocked successfully", data: record };
  req.statusCode = 200;
  return next();
};

const unblockUser = async (req, res, next) => {
  const orgId = resolveOrgId(req, req.query.org_id);
  const userId = String(req.params.user_id);
  await blockedOrgService.unblockUser(orgId, userId);
  if (client.isReady) await client.sRem(BLOCKED_USERS_KEY, `${orgId}_${userId}`);

  res.locals = { success: true, message: "User unblocked successfully" };
  req.statusCode = 200;
  return next();
};

const listBlockedUsers = async (req, res, next) => {
  const data = await blockedOrgService.getAllUsers(resolveOrgId(req, req.query.org_id));
  res.locals = { success: true, data };
  req.statusCode = 200;
  return next();
};

export default { blockOrg, unblockOrg, listBlockedOrgs, blockUser, unblockUser, listBlockedUsers };
