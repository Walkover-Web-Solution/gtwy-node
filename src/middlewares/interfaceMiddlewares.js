import jwt from "jsonwebtoken";
import { getOrganizationById } from "../services/proxy.service.js";
import { reportLoginFailure } from "../services/utils/utility.service.js";

const chatBotTokenDecode = async (req, res, next) => {
  const token = req?.get("Authorization");
  if (!token) {
    return res.status(498).json({ message: "invalid token" });
  }
  let failureType = "chatbot";
  try {
    const decodedToken = jwt.decode(token);
    failureType = decodedToken?.ispublic || decodedToken?.org_id === "public" ? "public_embed" : "chatbot";
    let orgToken;
    if (decodedToken) {
      const orgTokenFromDb = await getOrganizationById(decodedToken?.org_id);
      orgToken = orgTokenFromDb?.meta?.orgAccessToken;
      if (orgToken) {
        const checkToken = jwt.verify(token, orgToken);
        if (checkToken) {
          req.chatBot = checkToken;
          req.chatBot = {
            ...req.chatBot,
            ispublic: false
          };
          return next();
        }
        reportLoginFailure(failureType, token, "token verification failed");
        return res.status(404).json({ message: "unauthorized user" });
      }
    }
    reportLoginFailure(failureType, token, "invalid token");
    return res.status(401).json({ message: "unauthorized user 1", token });
  } catch (err) {
    console.error(err);
    reportLoginFailure(failureType, token, err?.message || "token error");
    return res.status(401).json({ message: "unauthorized user ", token });
  }
};
const chatBotAuth = async (req, res, next) => {
  // todo pending
  let token = req?.get("Authorization");
  token = token?.split(" ")?.[1] || token;
  if (!token) {
    return res.status(498).json({ message: "invalid token" });
  }
  try {
    const decodedToken = jwt.decode(token);
    if (decodedToken) {
      let checkToken = jwt.verify(token, process.env.CHATBOTSECRETKEY);
      if (checkToken) {
        checkToken.org_id = checkToken.org_id.toString();
        req.profile = checkToken;
        req.profile = {
          org: {
            id: checkToken.org_id,
            name: ""
          },
          user: {
            id: checkToken.user_id,
            name: ""
          }
        };
        req.body.org_id = checkToken?.org_id?.toString();
        req.isChatbot = true;
        req.chatBot = {
          ...req.chatBot,
          ispublic: false
        };
        if (!checkToken.user) req.profile.viewOnly = true;
        return next();
      }
    }
    return res.status(401).json({ message: "unauthorized user" });
  } catch (e) {
    return res.status(401).json({ message: "unauthorized user", error: e });
  }
};

const publicChatbotAuth = async (req, res, next) => {
  try {
    let checkToken = false;
    let token = req.headers["Authorization"] || req.headers["authorization"];
    token = token?.split(" ")?.[1] || token;
    if (token) {
      checkToken = jwt.verify(token, process.env.PUBLIC_CHATBOT_TOKEN, ["HS256"]);
      if (checkToken) {
        checkToken = jwt.decode(token);
        req.chatBot = checkToken;
        req.chatBot = {
          ...req.chatBot,
          ispublic: true
        };
        req.isChatbot = true;
        req.chatBot.limiter_key = checkToken.user_id;
        return next();
      }
    }
    return { success: false };
  } catch (err) {
    console.error(err);
    return { success: false };
  }
};

const combinedAuthWithChatBotAndPublicChatbot = async (req, res, next) => {
  try {
    // Try public chatbot auth first
    // await publicChatbotAuth(req, res, () => {});
    // if (req?.chatBot?.ispublic) {
    //   // If public auth succeeded, proceed
    //   return next();
    // }

    // If public auth failed, try chatbot auth
    await chatBotAuth(req, res, () => {});
    if (!req.chatBot?.ispublic && req.chatBot) {
      // If chatbot auth succeeded, proceed
      return next();
    }

    // If both auth methods failed
    return { success: false };
  } catch (err) {
    console.error(err);
    return { success: false };
  }
};

const combinedAuthWithChatBotTokenDecodeAndPublicChatbot = async (req, res, next) => {
  try {
    // Try public chatbot auth first
    await publicChatbotAuth(req, res, () => {});
    if (req?.chatBot?.ispublic) {
      // If public auth succeeded, proceed
      return next();
    }

    // If public auth failed, try chatbot token decode
    await chatBotTokenDecode(req, res, () => {});
    if (!req?.chatBot?.ispublic && req.chatBot) {
      // If chatbot token decode succeeded, proceed
      return next();
    }

    // If both auth methods failed
    return res.status(401).json({ message: "unauthorized user" });
  } catch (err) {
    return res.status(401).json({ message: "unauthorized user", error: err });
  }
};
export {
  chatBotTokenDecode,
  chatBotAuth,
  publicChatbotAuth,
  combinedAuthWithChatBotAndPublicChatbot,
  combinedAuthWithChatBotTokenDecodeAndPublicChatbot
};
