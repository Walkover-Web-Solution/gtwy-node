import jwt from "jsonwebtoken";
import { getOrganizationById } from "../services/proxy.service.js";
import { encryptString, reportLoginFailure } from "../services/utils/utility.service.js";
import { createOrGetUser } from "../utils/proxy.utils.js";

const GtwyEmbeddecodeToken = async (req, res, next) => {
  const token = req?.get("Authorization");
  if (!token) {
    return res.status(498).json({ message: "invalid token" });
  }
  try {
    const decodedToken = jwt.decode(token);
    if (!decodedToken.user_id || !decodedToken.folder_id || !decodedToken.org_id) {
      reportLoginFailure("embed", token, "user id, folder id or org id not provided");
      return res.status(401).json({ message: "unauthorized user, user id, folder id or org id not provided" });
    }
    if (decodedToken) {
      const orgTokenFromDb = await getOrganizationById(decodedToken?.org_id);
      const orgToken = orgTokenFromDb?.meta?.gtwyAccessToken;
      if (orgToken) {
        const checkToken = jwt.verify(token, orgToken);
        if (checkToken) {
          if (checkToken.user_id) checkToken.user_id = encryptString(checkToken.user_id);

          const proxyUserData = await createOrGetUser(checkToken, decodedToken, orgTokenFromDb);
          const { proxyResponse, name, email } = proxyUserData;
          req.Embed = {
            ...checkToken,
            email: email,
            name: name,
            org_name: orgTokenFromDb?.name,
            org_id: proxyResponse.data.company.id,
            folder_id: decodedToken.folder_id,
            user_id: proxyResponse.data.user.id
          };
          req.profile = {
            user: {
              id: proxyResponse.data.user.id,
              name: name
            },
            org: {
              id: proxyResponse.data.company.id,
              name: orgTokenFromDb?.name
            }
          };
          req.IsEmbedUser = true;
          return next();
        }
        reportLoginFailure("embed", token, "token verification failed");
        return res.status(404).json({ message: "unauthorized user" });
      }
    }
    reportLoginFailure("embed", token, "invalid token");
    return res.status(401).json({ message: "unauthorized user " });
  } catch (err) {
    reportLoginFailure("embed", token, err?.message || "token error");
    return res.status(401).json({ message: "unauthorized user ", err });
  }
};

export { GtwyEmbeddecodeToken };
