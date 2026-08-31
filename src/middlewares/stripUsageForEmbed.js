/**
 * Removes token/cost usage data from history responses for embed users.
 *
 * Conversation-log rows carry usage under a `tokens` object (counts plus
 * `cost.total_cost`), and nested `tools_call_data` entries carry their own
 * copy — so the strip is recursive.
 *
 * Register this with `router.use()` AFTER the route definitions: the history
 * controllers set `res.locals` and call `next()`, so control reaches here
 * before the global responseMiddleware serializes the payload.
 *
 * Scoped deliberately to history routes rather than the global responder —
 * a blanket strip of "tokens" would also hit auth/embed token payloads.
 */

const USAGE_KEYS = new Set(["tokens"]);

const stripUsageKeys = (value) => {
  if (Array.isArray(value)) return value.map(stripUsageKeys);

  if (value && typeof value === "object") {
    const result = {};
    for (const [key, nested] of Object.entries(value)) {
      if (USAGE_KEYS.has(key)) continue;
      result[key] = stripUsageKeys(nested);
    }
    return result;
  }

  return value;
};

/**
 * `req.IsEmbedUser` only reflects `extraDetails.type`, which is unset for embed
 * users authenticating with a normal JWT — their signal is `user.meta.type`.
 * Check every known signal, the same way the frontend's Protected.js does.
 */
const isEmbedRequest = (req) =>
  Boolean(
    req.IsEmbedUser ||
    req.embed ||
    req.profile?.user?.isEmbedUser ||
    req.profile?.user?.meta?.type === "embed" ||
    req.profile?.extraDetails?.type === "embed"
  );

const stripUsageForEmbed = (req, res, next) => {
  if (!isEmbedRequest(req) || !res.locals?.data) return next();

  try {
    // Round-trip first: rows may be Sequelize instances, and recursing into
    // those directly would walk internal fields instead of the serialized
    // shape. This yields exactly what res.json() would have produced.
    const serialized = JSON.parse(JSON.stringify(res.locals.data));
    res.locals = { ...res.locals, data: stripUsageKeys(serialized) };
  } catch (error) {
    // Never fail a history request over this — log and pass the payload through.
    console.error("stripUsageForEmbed failed, returning payload unchanged:", error?.message);
  }

  return next();
};

export default stripUsageForEmbed;
