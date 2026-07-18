import client from "./cache.service.js";
const BLOCKED_ORGS_KEY = `AIMIDDLEWARE_${process.env.ENVIRONMENT}_blocked_orgs`;

async function addBlockedOrgToCache(orgId) {
  if (!client.isReady) return false;
  return await client.sAdd(BLOCKED_ORGS_KEY, String(orgId));
}

async function removeBlockedOrgFromCache(orgId) {
  if (!client.isReady) return false;
  return await client.sRem(BLOCKED_ORGS_KEY, String(orgId));
}

async function isOrgBlockedInCache(orgId) {
  if (!client.isReady) return false;
  return await client.sIsMember(BLOCKED_ORGS_KEY, String(orgId));
}

export { BLOCKED_ORGS_KEY, addBlockedOrgToCache, removeBlockedOrgFromCache, isOrgBlockedInCache };
