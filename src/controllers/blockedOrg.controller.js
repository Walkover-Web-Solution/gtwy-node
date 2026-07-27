import blockedOrgService from "../db_services/blockedOrg.service.js";
import client from "../services/cache.service.js";

const BLOCKED_ORGS_KEY = `AIMIDDLEWARE_${process.env.ENVIRONMENT}_blocked_orgs`;

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

export default { blockOrg, unblockOrg, listBlockedOrgs };
