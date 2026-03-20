import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import axios from "axios"; // Added for making HTTP requests
import { getOrganizationById, validateCauthKey } from "../services/proxy.service.js";
import { encryptString, reportLoginFailure } from "../services/utils/utility.service.js";
import { createOrGetUser } from "../utils/proxy.utils.js";
import configurationModel from "../mongoModel/Configuration.model.js";
import mongoose from "mongoose";
import ConfigurationServices from "../db_services/configuration.service.js";
import agentVersionDbService from "../db_services/agentVersion.service.js";

dotenv.config();
import { findInCache } from "../cache_service/index.js";

// Define role permissions
const ROLE_PERMISSIONS = {
  viewer: ["get_agent"],
  editor: [
    "get_agent",
    "create_agent"
    // 'delete_agent',
    // 'update_agent'
  ],
  admin: ["get_agent", "create_agent", "clone_agent"]
};

/**
 * Determine user role based on their permissions.
 *
 * Logic:
 * 1. Check if isEmbed is true -> return 'editor' (embed users get editor role)
 * 2. Check if user has all permissions from 'admin' role -> return 'admin'
 * 3. Check if user has all permissions from 'editor' role -> return 'editor'
 * 4. Check if user has all permissions from 'viewer' role -> return 'viewer'
 * 5. If no match, return 'viewer' as default
 *
 * @param {Array} userPermissions - List of permission strings from JWT token
 * @param {Boolean} isEmbed - Boolean indicating if user is an embed user
 * @returns {string} Role name ('admin', 'editor', or 'viewer')
 */
const determineRoleFromPermissions = (userPermissions, isEmbed = false) => {
  // Check if user is an embed user first
  if (isEmbed) {
    return "editor";
  }

  if (!userPermissions || !Array.isArray(userPermissions)) {
    return "viewer";
  }

  // Convert to set for faster lookup
  const userPermsSet = new Set(userPermissions);

  // Check admin first (highest privilege)
  const adminPermsSet = new Set(ROLE_PERMISSIONS.admin);
  if ([...adminPermsSet].every((perm) => userPermsSet.has(perm))) {
    return "admin";
  }

  // Check editor
  const editorPermsSet = new Set(ROLE_PERMISSIONS.editor);
  if ([...editorPermsSet].every((perm) => userPermsSet.has(perm))) {
    return "editor";
  }

  // Check viewer
  const viewerPermsSet = new Set(ROLE_PERMISSIONS.viewer);
  if ([...viewerPermsSet].every((perm) => userPermsSet.has(perm))) {
    return "viewer";
  }

  // Default to viewer if no match
  return "viewer";
};

const makeDataIfProxyTokenGiven = async (req) => {
  const headers = {
    proxy_auth_token: req.headers.proxy_auth_token
  };
  const response = await axios.get("https://routes.msg91.com/api/c/getDetails", { headers });

  if (response.status !== 200 || !response.data) {
    throw new Error("Invalid token");
  }

  const responseData = response.data;
  console.log(responseData);
  return {
    ip: "9.255.0.55",
    user: {
      id: responseData.data[0].id,
      name: responseData.data[0].name,
      meta: responseData.data[0].meta,
      isEmbedUser: responseData.data[0].meta?.type === "embed",
      folder_id: responseData.data[0].meta?.folder_id
    },
    org: {
      id: responseData.data[0].currentCompany.id,
      name: responseData.data[0].currentCompany.name
    }
  };
};

const makeDataIfPauthKeyGiven = async (req) => {
  const pauthkey = req.headers.pauthkey || req.headers.pauthtoken;
  if (!pauthkey) {
    throw new Error("Invalid pauthkey");
  }

  const response = await validateCauthKey(pauthkey);
  const company = response?.data?.company;
  const authkey = response?.data?.authkey;

  if (!company?.id) {
    throw new Error("Invalid pauthkey response");
  }

  return {
    ip: "9.255.0.55",
    user: {
      id: authkey?.id || null,
      name: authkey?.name || "",
      meta: {
        throttle_limit: authkey?.throttle_limit,
        temporary_throttle_limit: authkey?.temporary_throttle_limit,
        temporary_throttle_time: authkey?.temporary_throttle_time
      }
    },
    org: {
      id: company.id,
      name: company.name
    },
    extraDetails: {
      tokenType: null,
      message: response?.data?.message,
      proxy_auth_type: "pauthkey"
    },
    authkey,
    proxyResponse: response?.data
  };
};

const middleware = async (req, res, next) => {
  try {
    if (req.get("Authorization")) {
      const token = req.get("Authorization");
      if (!token) {
        return res.status(401).json({ message: "invalid token" });
      }

      const isBlacklisted = await findInCache(`blacklist:${token}`);
      if (isBlacklisted) {
        return res.status(401).json({ message: "token revoked" });
      }

      req.profile = jwt.verify(token, process.env.SecretKey);
      // Determine role_name from permissions in JWT token
      const userPermissions = req.profile?.user?.permissions || [];
      // Check if user is embed user
      const isEmbed = req.profile?.extraDetails?.type === "embed" || req.profile?.extraDetails?.tokenType || false;
      const determinedRole = determineRoleFromPermissions(userPermissions, isEmbed);

      // Set role_name in user object for consistency
      if (!req.profile.user) {
        req.profile.user = {};
      }
      req.profile.user.role_name = determinedRole;
    } else if (req.headers.pauthkey || req.headers.pauthtoken) {
      req.profile = await makeDataIfPauthKeyGiven(req);
    } else if (req.headers["proxy_auth_token"]) {
      req.profile = await makeDataIfProxyTokenGiven(req);
    }

    req.profile.org.id = req.profile.org.id.toString();
    req.IsEmbedUser = req.profile?.extraDetails?.type === "embed" || req.profile?.extraDetails?.tokenType || false;

    // Store user_id and role_name in req for agent access middleware (similar to Python's request.state)
    req.user_id = req.profile?.user?.id ? req.profile.user.id.toString() : null;
    req.role_name = req.profile?.user?.role_name || null;
    req.org_id = req.profile.org.id;
    req.embed = req.profile?.extraDetails?.type === "embed" || req.profile?.extraDetails?.tokenType || false;
    if (req.embed) {
      req.folder_id = req.profile?.extraDetails?.folder_id || null;
    }
    let ownerId = req.org_id;
    if (req.user_id && req.folder_id) {
      ownerId = req.org_id + "_" + req.folder_id.toString() + "_" + req.user_id.toString();
    }
    req.ownerId = ownerId;
    return next();
  } catch (err) {
    console.error("middleware error =>", err);
    return res.status(401).json({ message: "unauthorized user" });
  }
};

const combine_middleware = async (req, res, next) => {
  try {
    let token = req.get("Authorization");
    token = token?.split(" ")?.[1] || token;
    if (token) {
      try {
        const decodedToken = jwt.decode(token);
        if (decodedToken) {
          // Check for middleware authorization
          let middlewareToken = jwt.verify(token, process.env.SecretKey);
          if (middlewareToken) {
            middlewareToken.org_id = middlewareToken.org.id.toString();
            req.profile = middlewareToken;
            req.body.org_id = middlewareToken?.org.id?.toString();
            return next();
          }
        }
      } catch (e) {
        console.error("Middleware token verification failed", e);
        // Check for chatbot authorization if middleware verification fails
        try {
          let chatbotToken = jwt.verify(token, process.env.CHATBOTSECRETKEY);
          if (chatbotToken) {
            chatbotToken.org_id = chatbotToken.org_id.toString();
            req.profile = chatbotToken;
            req.body.org_id = chatbotToken?.org_id?.toString();
            if (!chatbotToken.user) req.profile.viewOnly = true;
            return next();
          }
        } catch (e) {
          console.error("Chatbot token verification failed", e);
        }
      }
    }

    if (req.headers.pauthkey) {
      try {
        req.profile = await makeDataIfPauthKeyGiven(req);
        req.profile.org.id = req.profile.org.id.toString();
        req.body.org_id = req.profile.org.id;
        return next();
      } catch (e) {
        console.error("Pauthkey verification failed", e);
      }
    }

    if (req.headers["proxy_auth_token"]) {
      try {
        req.profile = await makeDataIfProxyTokenGiven(req);
        req.profile.org.id = req.profile.org.id.toString();
        req.body.org_id = req.profile.org.id;
        return next();
      } catch (e) {
        console.error("Proxy token verification failed", e);
      }
    }

    return res.status(401).json({ message: "unauthorized user" });
  } catch (e) {
    console.error("middleware error =>", e);
    return res.status(401).json({ message: "unauthorized user" });
  }
};

const EmbeddecodeToken = async (req, res, next) => {
  const token = req?.get("Authorization");
  if (!token) {
    return res.status(498).json({ message: "invalid token" });
  }
  try {
    const decodedToken = jwt.decode(token);
    if (decodedToken) {
      if (!decodedToken.user_id || !decodedToken.folder_id || !decodedToken.org_id) {
        return res.status(401).json({ message: "unauthorized user, user id, folder id or org id not provided" });
      }
      // const orgTokenFromDb = await orgDbServices.find(decodedToken.org_id);
      const orgTokenFromDb = await getOrganizationById(decodedToken?.org_id);
      const orgToken = orgTokenFromDb?.meta?.auth_token;
      if (orgToken && !decodedToken?.gtwyAIDocs) {
        const checkToken = jwt.verify(token, orgToken);
        if (checkToken) {
          if (checkToken.user_id) checkToken.user_id = encryptString(checkToken.user_id);
          const { proxyResponse, name, email } = await createOrGetUser(checkToken, decodedToken, orgTokenFromDb);
          req.Embed = {
            ...checkToken,
            name,
            email,
            user_id: proxyResponse.data.user.id,
            org_name: orgTokenFromDb?.name,
            org_id: proxyResponse.data.company.id,
            folder_id: checkToken?.folder_id
          };
          req.profile = {
            user: {
              id: proxyResponse.data.user.id,
              name: ""
            },
            org: {
              id: proxyResponse.data.company.id,
              name: orgTokenFromDb?.name
            }
          };
          req.IsEmbedUser = true;
          return next();
        }
        reportLoginFailure("rag", token, "token verification failed");
        return res.status(404).json({ message: "unauthorized user" });
      } else if (orgToken) {
        const checkToken = jwt.verify(token, orgToken);
        if (checkToken) {
          req.isGtwyUser = true;
          req.company_id = decodedToken?.org_id;
          req.company_name = orgTokenFromDb?.name;
          req.email = orgTokenFromDb?.email;
          req.user_id = orgTokenFromDb?.created_by;
          return next();
        }
      }
      reportLoginFailure("rag", token, "invalid token");
      return res.status(404).json({ message: "unauthorized user" });
    }
    reportLoginFailure("rag", token, "invalid token");
    return res.status(401).json({ message: "unauthorized user " });
  } catch (err) {
    reportLoginFailure("rag", token, err?.message || "token error");
    return res.status(401).json({ message: "unauthorized user ", err });
  }
};
const InternalAuth = async (req, res, next) => {
  return next();
};

const loginAuth = async (req, res, next) => {
  req.profile = await makeDataIfProxyTokenGiven(req);

  return next();
};

/**
 * Helper function to get access role for a specific bridge.
 *
 * Logic:
 * 1. If original_role_name is 'admin' -> return 'admin' (no DB check needed)
 * 2. If 'users' array exists in configuration and contains user_id -> return 'editor'
 * 3. If 'users' array doesn't exist -> return original_role_name
 * 4. If 'users' array exists but doesn't contain user_id -> return 'viewer'
 *
 * @param {string} user_id - User ID
 * @param {string} org_id - Organization ID
 * @param {string} bridge_id - Bridge ID
 * @param {string} original_role_name - Original role name from JWT
 * @returns {Promise<string>} The access role ('admin', 'editor', 'viewer', or original_role_name)
 */
const getAgentAccessRole = async (user_id, org_id, bridge_id, original_role_name = null) => {
  try {
    // If user is admin, return 'admin' immediately without checking DB
    if (original_role_name === "admin") {
      return "admin";
    }

    if (!user_id) {
      // If no user_id, return original role_name
      return original_role_name;
    }

    // Query configuration collection for the bridge
    try {
      const bridge_doc = await configurationModel.findOne({ _id: new mongoose.Types.ObjectId(bridge_id), org_id: org_id }, { users: 1 }).lean();

      if (!bridge_doc) {
        // Bridge not found, return original role_name
        return original_role_name;
      }

      // Check if 'users' key exists
      const users_array = bridge_doc.users;

      if (users_array === null || users_array === undefined) {
        // 'users' key doesn't exist, return original role_name
        return original_role_name;
      }

      // Ensure users_array is a list
      if (!Array.isArray(users_array)) {
        // If 'users' exists but is not a list, return original role_name
        return original_role_name;
      }

      // Convert user_id to string for comparison (users array might contain strings or integers)
      const user_id_str = user_id.toString();

      // Check if user_id is in the users array
      // Handle both string and integer comparisons
      const user_found = users_array.some((u) => u.toString() === user_id_str);

      if (user_found) {
        // User found in array, return 'editor'
        return "editor";
      } else {
        // User not found in array, return 'viewer'
        return "viewer";
      }
    } catch (e) {
      console.error(`Error querying configuration for bridge ${bridge_id}:`, e);
      // If query fails, return original role_name
      return original_role_name;
    }
  } catch (err) {
    console.error(`Error in getAgentAccessRole:`, err);
    // On error, return original role_name
    return original_role_name;
  }
};

/**
 * Middleware to check and update user's role_name based on agent-specific permissions.
 * Stores the result in req.access_role.
 * Reads agent_id from req.params.agent_id, req.params.bridgeId or req.params.bridge_id
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const checkAgentAccessMiddleware = async (req, res, next) => {
  try {
    const agent_id = req.params.agent_id || req.params.bridgeId || req.params.bridge_id;

    const user_id = req.user_id;
    const original_role_name = req.role_name;
    const org_id = req.org_id;

    const access_role = await getAgentAccessRole(user_id, org_id, agent_id, original_role_name);
    if (access_role === "viewer") {
      return res.status(403).json({
        success: false,
        message: "You don't have access"
      });
    }
    req.access_role = access_role;

    return next();
  } catch (err) {
    console.error("Error in checkAgentAccessMiddleware:", err);
    // On error, fallback to original role_name
    req.access_role = req.role_name || null;
    return next();
  }
};

/**
 * Middleware to check if user has permission for write operations on agent.
 *
 * Logic:
 * 1. If role is 'admin' -> always allow (highest privilege)
 * 2. If role is 'viewer' -> check if user_id is in agent's users array
 *    - If yes -> allow
 *    - If no -> deny
 * 3. If role is 'editor' -> check if users array exists in agent
 *    - If users array exists and user_id is in it -> allow
 *    - If users array exists and user_id is NOT in it -> deny
 *    - If users array doesn't exist -> allow
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const requireAdminRole = async (req, res, next) => {
  try {
    const role_name = req.role_name;
    const user_id = req.user_id;
    const org_id = req.org_id;

    // Admin always has access
    if (role_name === "admin") {
      return next();
    }

    // Get agent_id from request params
    const agent_id = req.params.agent_id || req.params.bridgeId || req.params.bridge_id || req.params.version_id;

    // If no agent_id, check role (for create operations)
    if (!agent_id) {
      if (role_name === "viewer") {
        return res.status(403).json({
          success: false,
          message: "You don't have access to update this agent"
        });
      }
      return next();
    }

    // Query the agent to get users array
    try {
      let usersArray = null;

      // Check if it's a version_id or agent_id
      if (req.params.version_id) {
        // For version operations, get parent agent_id first
        const version = await agentVersionDbService.getVersion(req.params.version_id);
        if (version && version.parent_id) {
          usersArray = await ConfigurationServices.getAgentUsers(version.parent_id, org_id);
        }
      } else {
        // Direct agent operation
        usersArray = await ConfigurationServices.getAgentUsers(agent_id, org_id);
      }

      // Check if user_id is in the users array
      const isUserInArray = usersArray && Array.isArray(usersArray) && usersArray.some((u) => String(u) === String(user_id));

      // Handle viewer role
      if (role_name === "viewer") {
        if (isUserInArray) {
          return next(); // Viewer has access if in users array
        }
        return res.status(403).json({
          success: false,
          message: "You don't have access to update this agent"
        });
      }

      // Handle editor role
      if (role_name === "editor") {
        // If users array doesn't exist, allow editor
        if (!usersArray || !Array.isArray(usersArray)) {
          return next();
        }

        // If users array exists, check if user is in it
        if (isUserInArray) {
          return next();
        }

        // Users array exists but user is not in it
        return res.status(403).json({
          success: false,
          message: "You don't have access to update this agent"
        });
      }

      // For any other role, deny by default
      return res.status(403).json({
        success: false,
        message: "You don't have access to update this agent"
      });
    } catch (dbError) {
      console.error("Error querying agent users:", dbError);
      // On DB error, fallback to role-based check
      if (role_name === "viewer") {
        return res.status(403).json({
          success: false,
          message: "You don't have access to update this agent"
        });
      }
      return next();
    }
  } catch (err) {
    console.error("Error in requireAdminRole:", err);
    return res.status(403).json({
      success: false,
      message: "You don't have access to update this agent"
    });
  }
};

export {
  middleware,
  combine_middleware,
  EmbeddecodeToken,
  InternalAuth,
  loginAuth,
  checkAgentAccessMiddleware,
  getAgentAccessRole,
  requireAdminRole
};
