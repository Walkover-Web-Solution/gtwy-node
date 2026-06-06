import client from "../services/cache.service.js";
import logger from "../logger.js";

const ENV_PREFIX = `AIMIDDLEWARE_${process.env.ENVIRONMENT}_nd_rate_limit_`;

/**
 * Resolve the client IP. Behind a proxy/load balancer (e.g. db.gtwy.ai) the real
 * client IP is the first entry of X-Forwarded-For; fall back to the socket address.
 */
const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
};

/**
 * Fixed-window, per-IP rate limiter backed by Redis (atomic INCR + EXPIRE), so the
 * limit is shared correctly across multiple app instances.
 *
 * Fails OPEN: if Redis is unavailable or errors, the request is allowed through
 * rather than blocking legitimate traffic on an infra issue.
 *
 * @param {object} options
 * @param {number} options.limit         Max requests allowed per window per IP.
 * @param {number} options.windowSeconds Window length in seconds.
 * @param {string} options.keyPrefix     Namespace so multiple limiters don't collide.
 */
const rateLimit =
  ({ limit, windowSeconds, keyPrefix }) =>
  async (req, res, next) => {
    // Fail open when Redis isn't ready.
    if (!client.isReady) {
      return next();
    }

    const ip = getClientIp(req);
    const key = `${ENV_PREFIX}${keyPrefix}:${ip}`;

    try {
      const count = await client.incr(key);
      if (count === 1) {
        // First hit in this window — start the expiry clock.
        await client.expire(key, windowSeconds);
      }

      const ttl = await client.ttl(key);
      // Defensive: if somehow no TTL was set, set it now so the key can't live forever.
      const retryAfter = ttl > 0 ? ttl : windowSeconds;
      if (ttl < 0) {
        await client.expire(key, windowSeconds);
      }

      res.set("X-RateLimit-Limit", String(limit));
      res.set("X-RateLimit-Remaining", String(Math.max(0, limit - count)));

      if (count > limit) {
        res.set("Retry-After", String(retryAfter));
        return res.status(429).json({
          success: false,
          error: `Rate limit exceeded. Max ${limit} requests per ${windowSeconds} seconds per IP. Retry after ${retryAfter}s.`
        });
      }

      return next();
    } catch (error) {
      logger.error(`Rate limit middleware error (key=${key}): ${error.message}`);
      // Fail open on unexpected Redis errors.
      return next();
    }
  };

export default rateLimit;
