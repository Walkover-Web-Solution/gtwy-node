import { storeInCache } from "../cache_service/index.js";
import { updateProxyDetails, getProxyDetails, removeClientUser } from "../services/proxy.service.js";
import axios from "axios";
import { blacklistToken } from "../services/token.service.js";

const userOrgLocalToken = async (req, res, next) => {
  // Call external API to generate auth token
  const apiUrl = `https://routes.msg91.com/api/${process.env.PUBLIC_REFERENCEID}/generateAuthToken`;
  const response = await axios.get(apiUrl, {
    headers: {
      authkey: process.env.ADMIN_API_KEY,
      proxy_auth_token: req.headers.proxy_auth_token || req.headers.authorization?.replace("Bearer ", "")
    }
  });

  const token = response.data.data.jwt;
  res.locals = { data: { token }, success: true };
  req.statusCode = 200;
  return next();
};

const switchUserOrgLocal = async (req, res, next) => {
  const oldToken = req.get("Authorization");
  // Call external API to generate auth token with new org
  const apiUrl = `https://routes.msg91.com/api/${process.env.PUBLIC_REFERENCEID}/generateAuthToken`;
  const response = await axios.get(apiUrl, {
    headers: {
      authkey: process.env.ADMIN_API_KEY,
      proxy_auth_token: req.headers.proxy_auth_token || req.headers.authorization?.replace("Bearer ", "")
    }
  });
  // const token = reissueToken(jwtToken);
  const token = response.data.data.jwt;
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

export { userOrgLocalToken, switchUserOrgLocal, updateUserDetails, removeUsersFromOrg, logout };
