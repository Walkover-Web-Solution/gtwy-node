import UserCreditLimitModel from "../mongoModel/UserCreditLimit.model.js";
import { deleteInCache, findInCache } from "../cache_service/index.js";

// Per-user credit caps inside an embed folder. Money stays in the org wallet;
// these rows are only limits. Python enforces them at the request gate and
// keeps the live counters — this controller is the admin's pen.

// Keep in sync with sanitize_user_id in Python's
// src/services/billing/user_credit_limits.py — both sides must derive the
// same Redis key from the same user_id.
const sanitizeUserId = (user_id) => String(user_id).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64);

const LIMIT_CACHE_KEY = "nd_user_credit_limit_";
const USAGE_KEY = "nd_userusedcost_";

const limitCacheKey = (folder_id, user_id) => `${LIMIT_CACHE_KEY}${folder_id}_${sanitizeUserId(user_id)}`;
const usageKey = (folder_id, user_id) => `${USAGE_KEY}${folder_id}_${sanitizeUserId(user_id)}`;

const setUserLimit = async (req, res, next) => {
  const org_id = String(req.profile.org.id);
  const { folder_id, user_id, user_limit, user_limit_reset_period } = req.body;

  const existing = await UserCreditLimitModel.findOne({ org_id, folder_id: String(folder_id), user_id: String(user_id) });

  const update = { user_limit };
  if (user_limit_reset_period) {
    update.user_limit_reset_period = user_limit_reset_period;
    // A new period re-anchors the reset window (same behavior as agent limits).
    if (!existing || existing.user_limit_reset_period !== user_limit_reset_period) {
      update.user_limit_start_date = new Date();
    }
  }

  const doc = await UserCreditLimitModel.findOneAndUpdate(
    { org_id, folder_id: String(folder_id), user_id: String(user_id) },
    { $set: update, $setOnInsert: { org_id, folder_id: String(folder_id), user_id: String(user_id) } },
    { upsert: true, new: true }
  );

  // Python caches the limit doc for 5 minutes — bust it so the change bites now.
  await deleteInCache(limitCacheKey(folder_id, user_id));

  res.locals = { success: true, message: "user credit limit saved", data: doc };
  req.statusCode = 200;
  return next();
};

const listUserLimits = async (req, res, next) => {
  const org_id = String(req.profile.org.id);
  const { folder_id } = req.query;

  const query = { org_id };
  if (folder_id) query.folder_id = String(folder_id);
  const docs = await UserCreditLimitModel.find(query);

  // Show live usage from the same Redis counters Python increments.
  const withUsage = await Promise.all(
    docs.map(async (doc) => {
      const row = doc.toObject();
      row.user_usage_live = row.user_usage;
      try {
        const cached = await findInCache(usageKey(row.folder_id, row.user_id));
        if (cached) row.user_usage_live = JSON.parse(cached).usage_value ?? row.user_usage;
      } catch {
        // keep the Mongo seed value
      }
      return row;
    })
  );

  res.locals = { success: true, data: withUsage };
  req.statusCode = 200;
  return next();
};

const removeUserLimit = async (req, res, next) => {
  const org_id = String(req.profile.org.id);
  const { folder_id, user_id } = req.body;

  await UserCreditLimitModel.deleteOne({ org_id, folder_id: String(folder_id), user_id: String(user_id) });
  await deleteInCache(limitCacheKey(folder_id, user_id));

  res.locals = { success: true, message: "user credit limit removed" };
  req.statusCode = 200;
  return next();
};

export default { setUserLimit, listUserLimits, removeUserLimit };
