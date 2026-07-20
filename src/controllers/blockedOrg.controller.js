import blockedOrgService from "../db_services/blockedOrg.service.js";
import { addBlockedOrgToCache, removeBlockedOrgFromCache } from "../services/blockedOrgCache.service.js";

const blockOrg = async (req, res, next) => {
  const { org_id, reason } = req.body;

  if (!org_id) {
    req.statusCode = 400;
    res.locals = { success: false, message: "org_id is required" };
    return next();
  }

  const orgId = String(org_id);
  const record = await blockedOrgService.block({ org_id: orgId, reason: reason || null, blocked_by: req.profile?.user?.id || null });
  // Take effect immediately; the Python service also reloads the full set on startup.
  await addBlockedOrgToCache(orgId);

  res.locals = { success: true, message: "Organization blocked successfully", data: record };
  req.statusCode = 200;
  return next();
};

const unblockOrg = async (req, res, next) => {
  const org_id = req.body?.org_id || req.params?.org_id;

  if (!org_id) {
    req.statusCode = 400;
    res.locals = { success: false, message: "org_id is required" };
    return next();
  }

  const orgId = String(org_id);
  await blockedOrgService.unblock(orgId);
  await removeBlockedOrgFromCache(orgId);

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

export default { blockOrg, unblockOrg, listBlockedOrgs };
