import { generateIdentifier, generateAuthToken } from "../services/utils/utility.service.js";
import { getOrganizationById, updateOrganizationData, createProxyToken } from "../services/proxy.service.js";
import auth_service from "../db_services/auth.service.js";
import jwt from "jsonwebtoken";

const createAuthToken = async (req, res, next) => {
  const org_id = req.profile.org.id;
  const auth_token = generateIdentifier(14);
  const data = await getOrganizationById(org_id);
  if (!data?.meta?.auth_token)
    await updateOrganizationData(org_id, {
      meta: {
        ...data?.meta,
        auth_token
      }
    });
  res.locals = { auth_token: data?.meta?.auth_token || auth_token };
  req.statusCode = 200;
  return next();
};

const saveAuthTokenInDbController = async (req, res, next) => {
  const { name, redirection_url } = req.body;
  const org_id = req.profile.org.id;

  const result = await auth_service.saveAuthTokenInDb(name, redirection_url, org_id);
  res.locals = {
    success: true,
    message: "Auth token saved successfully",
    result
  };
  req.statusCode = 201;
  return next();
};

const getAuthTokenInDbController = async (req, res, next) => {
  const org_id = req.profile.org.id;

  const result = await auth_service.findAuthByOrgId(org_id);

  res.locals = {
    success: true,
    message: "Auth token found successfully",
    result
  };
  req.statusCode = 200;
  return next();
};

const verifyAuthTokenController = async (req, res) => {
  const { client_id, redirection_url, state } = req.body;
  const { user, org } = req.profile;

  await auth_service.verifyAuthToken(client_id, redirection_url);

  const data = {
    company_id: org.id,
    user_id: user.id
  };

  const accessToken = await createProxyToken({
    ...data
  });

  const refreshToken = jwt.sign({ ...data }, process.env.SecretKey);

  return res.redirect(301, `${redirection_url}?access_token=${accessToken}&refresh_token=${refreshToken}&state=${state}`);
};

const getClientInfoController = async (req, res, next) => {
  const { client_id } = req.query;

  if (!client_id) {
    throw new Error("Client id is required");
  }

  const result = await auth_service.findAuthByClientId(client_id);

  res.locals = {
    success: true,
    message: "Client info found successfully",
    result
  };
  req.statusCode = 200;
  return next();
};

const generateLocalToken = async (req, res) => {
  const secretKey = req.headers["automation-token"];
  if (!secretKey || secretKey !== process.env.AUTOMATION_TOKEN) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const { env } = req.body;

  const configs = {
    dev: {
      user: {
        id: "62514",
        email: "human@gtwy.ai",
        permissions: [
          "create_c_company",
          "update_c_company",
          "add_user",
          "get_authkeys",
          "create_authkey",
          "update_authkey",
          "delete_authkey",
          "get_authkey_ips",
          "create_authkey_ip",
          "update_authkey_ip",
          "delete_authkey_ip",
          "get_c_roles",
          "create_c_roles",
          "update_c_roles",
          "delete_c_roles",
          "update_c_user_role",
          "update_c_user",
          "view_c_user",
          "assign_permissions",
          "remove_c_user_from_c_company",
          "view_agent",
          "get_agent",
          "publish_version",
          "discard_version",
          "clone_agent",
          "create_agent"
        ]
      },
      org: { id: "59402" }
    },
    prod: {
      user: {
        id: "61704",
        email: "human@gtwy.ai",
        permissions: [
          "create_c_company",
          "update_c_company",
          "add_user",
          "get_authkeys",
          "create_authkey",
          "update_authkey",
          "delete_authkey",
          "get_authkey_ips",
          "create_authkey_ip",
          "update_authkey_ip",
          "delete_authkey_ip",
          "get_c_roles",
          "create_c_roles",
          "update_c_roles",
          "delete_c_roles",
          "update_c_user_role",
          "update_c_user",
          "view_c_user",
          "assign_permissions",
          "remove_c_user_from_c_company",
          "view_agent",
          "get_agent",
          "publish_version",
          "discard_version",
          "clone_agent",
          "create_agent"
        ]
      },
      org: { id: "60053" }
    }
  };

  const config = configs[env];
  if (!config) {
    return res.status(400).json({ success: false, message: "env must be 'dev' or 'prod'" });
  }

  const [token, proxy_auth_token] = await Promise.all([
    generateAuthToken(config.user, config.org),
    createProxyToken({ user_id: config.user.id, company_id: config.org.id })
  ]);

  return res.status(200).json({ success: true, token, proxy_auth_token });
};

export {
  createAuthToken,
  saveAuthTokenInDbController,
  verifyAuthTokenController,
  getClientInfoController,
  getAuthTokenInDbController,
  generateLocalToken
};
