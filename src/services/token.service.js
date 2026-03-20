import jwt from "jsonwebtoken";
import { storeInCache } from "../cache_service/index.js";

/**
 * Blacklist a token by storing it in cache until expiry
 * @param {string} token - The JWT token to blacklist
 * @returns {Promise<boolean>} - Returns true if blacklisted, false if already expired
 */
export const blacklistToken = async (token) => {
  if (!token) {
    return false;
  }

  const decoded = jwt.decode(token);

  if (!decoded?.exp) {
    return false;
  }

  const currentTime = Math.floor(Date.now() / 1000);
  const remainingTTL = decoded.exp - currentTime;

  if (remainingTTL > 0) {
    await storeInCache(`blacklist:${token}`, { revoked: true, revokedAt: new Date().toISOString() }, remainingTTL);
    return true;
  }

  return false;
};
