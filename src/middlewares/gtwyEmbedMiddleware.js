import jwt from "jsonwebtoken";
import { getOrganizationById } from "../services/proxy.service.js";
import { encryptString, unknown_error_handler_alert } from "../services/utils/utility.service.js";
import { createOrGetUser } from "../utils/proxy.utils.js";

// Attach the HTTP status GtwyEmbeddecodeToken has always answered with for this failure.
const embedAuthError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const resolveGtwyEmbedToken = async (token) => {
  if (!token) {
    throw embedAuthError("invalid token", 498);
  }

  const decodedToken = jwt.decode(token);
  if (!decodedToken) {
    throw embedAuthError("invalid token", 401);
  }

  if ((!decodedToken.user_id && !decodedToken.unique_identifier) || !decodedToken.folder_id || !decodedToken.org_id) {
    throw embedAuthError("unauthorized user, user_id (or unique_identifier), folder id or org id not provided", 401);
  }

  const orgTokenFromDb = await getOrganizationById(decodedToken?.org_id);
  const orgToken = orgTokenFromDb?.meta?.gtwyAccessToken;
  if (!orgToken) {
    throw embedAuthError("invalid token", 401);
  }

  const checkToken = jwt.verify(token, orgToken);
  if (!checkToken) {
    throw embedAuthError("token verification failed", 404);
  }

  const embedUserId = checkToken.user_id || checkToken.unique_identifier;
  if (embedUserId) checkToken.user_id = encryptString(embedUserId);

  const { proxyResponse, name, email } = await createOrGetUser(checkToken, decodedToken, orgTokenFromDb);
  const meta = proxyResponse.data.user.meta;

  return {
    Embed: {
      ...checkToken,
      email: email,
      name: name,
      meta: meta,
      org_name: orgTokenFromDb?.name,
      org_id: proxyResponse.data.company.id,
      folder_id: decodedToken.folder_id,
      user_id: proxyResponse.data.user.id
    },
    profile: {
      user: {
        id: proxyResponse.data.user.id,
        name: name,
        meta: meta
      },
      org: {
        id: proxyResponse.data.company.id,
        name: orgTokenFromDb?.name
      },
      extraDetails: {
        type: "embed",
        folder_id: decodedToken.folder_id
      }
    }
  };
};

// Embed-only routes: the embed token arrives in the Authorization header.
const GtwyEmbeddecodeToken = async (req, res, next) => {
  const token = req?.get("Authorization");
  try {
    const { Embed, profile } = await resolveGtwyEmbedToken(token);
    req.Embed = Embed;
    req.profile = profile;
    req.IsEmbedUser = true;
    return next();
  } catch (err) {
    if (err?.statusCode === 498) {
      return res.status(498).json({ message: err.message });
    }
    unknown_error_handler_alert("embed", token, err?.message || "token error");
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    return res.status(401).json({ message: "unauthorized user ", err });
  }
};

export { GtwyEmbeddecodeToken, resolveGtwyEmbedToken };
