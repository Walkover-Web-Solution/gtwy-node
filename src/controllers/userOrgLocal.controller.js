import { storeInCache } from "../cache_service/index.js";
import {
  updateProxyDetails,
  getProxyDetails,
  removeClientUser,
  generateProxyAuthToken,
  getProxyTokenIdentity,
  createOrFindUserAndCompany,
  createProxyToken
} from "../services/proxy.service.js";
import { blacklistToken } from "../services/token.service.js";

const userOrgLocalToken = async (req, res, next) => {
  const token = await generateProxyAuthToken(req);
  res.locals = { data: { token }, success: true };
  req.statusCode = 200;
  return next();
};

const switchUserOrgLocal = async (req, res, next) => {
  const oldToken = req.get("Authorization");
  const token = await generateProxyAuthToken(req);
  if (oldToken) {
    await blacklistToken(oldToken);
  }
  res.locals = { data: { token }, success: true };
  req.statusCode = 200;
  return next();
};

const updateUserDetails = async (req, res, next) => {
  const { company_id, company, user_id, user } = req.body;
  const isCompanyUpdate = company_id && company;
  const updateObject = isCompanyUpdate ? { company_id, company: { meta: company?.meta } } : { user_id, Cuser: { meta: user?.meta } };

  const data = await updateProxyDetails(updateObject);

  if (isCompanyUpdate) {
    await storeInCache(company_id, data?.data?.company);
  } else {
    await storeInCache(user_id, data?.data?.user);
  }

  res.locals = {
    message: isCompanyUpdate ? "Company details updated successfully" : "User details updated successfully",
    data,
    success: true
  };
  req.statusCode = 200;
  return next();
};

const removeUsersFromOrg = async (req, res, next) => {
  const { user_id: userId } = req.body;
  const companyId = req.profile.org.id;
  const featureId = `${process.env.PUBLIC_REFERENCEID}`;

  const user_detail = await getProxyDetails({
    company_id: companyId,
    pageNo: 1,
    itemsPerPage: 1
  });

  const ownerId = user_detail.data.data[0].id;
  if (userId === ownerId) {
    throw new Error("You cannot remove the owner of the organization");
  }

  const response = await removeClientUser(userId, companyId, featureId);

  res.locals = { data: response.data.message, success: true };
  req.statusCode = 200;
  return next();
};

const logout = async (req, res, next) => {
  try {
    const token = req.get("Authorization");
    if (!token) {
      res.locals = { success: false, message: "No token provided" };
      req.statusCode = 400;
      return next();
    }
    await blacklistToken(token);
    res.locals = { success: true, message: "Logged out successfully" };
    req.statusCode = 200;
    return next();
  } catch {
    res.locals = { success: false, message: "Logout failed" };
    req.statusCode = 500;
    return next();
  }
};

const ADMIN_COMPANY_NAME = "GTWY Admin";

// Admin console sign-in: trades an admin-project proxy token for a platform one.
const adminProxyToken = async (req, res, next) => {
  const token = req.headers.proxy_auth_token;
  if (!token) {
    res.locals = { success: false, message: "proxy_auth_token header is required" };
    req.statusCode = 400;
    return next();
  }

  const identity = await getProxyTokenIdentity(token);
  if (!identity.email) {
    res.locals = { success: false, message: "proxy_auth_token has no email" };
    req.statusCode = 401;
    return next();
  }

  // MSG91 rejects a Cuser.name containing anything but letters and spaces.
  const name = (identity.name || "").replace(/[^A-Za-z ]/g, "").trim() || "Admin";
  const created = await createOrFindUserAndCompany({
    feature_id: process.env.PUBLIC_REFERENCEID,
    Cuser: { name, email: identity.email.toLowerCase(), meta: { type: "admin" } },
    company: { name: ADMIN_COMPANY_NAME, is_readable: true }
  });

  const userId = created?.data?.user?.id;
  const companyId = created?.data?.company?.id;
  if (!userId || !companyId) throw new Error("createCUsers returned no user or company id");

  const proxyAuthToken = await createProxyToken({ user_id: userId, company_id: companyId });
  if (!proxyAuthToken) throw new Error("getAuthToken returned no proxy_auth_token");

  res.locals = { data: { proxy_auth_token: proxyAuthToken }, success: true };
  req.statusCode = 200;
  return next();
};

export { userOrgLocalToken, adminProxyToken, switchUserOrgLocal, updateUserDetails, removeUsersFromOrg, logout };
