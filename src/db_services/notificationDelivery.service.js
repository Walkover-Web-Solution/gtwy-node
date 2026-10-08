import NotificationDeliveryModel from "../mongoModel/NotificationDelivery.model.js";

// Delay before attempt n+1, after attempt n failed. After the last one the delivery is failed.
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];

// Returns the created row, or null when this event × rule × channel already has one.
async function createDelivery(row) {
  try {
    return await new NotificationDeliveryModel(row).save();
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
}

async function markSent(id, response_code) {
  return await NotificationDeliveryModel.findByIdAndUpdate(
    id,
    { $set: { status: "sent", response_code, error: null, next_retry_at: null, sent_at: new Date() }, $inc: { attempts: 1 } },
    { new: true }
  ).lean();
}

async function markAttemptFailed(id, { response_code = null, error }) {
  const delivery = await NotificationDeliveryModel.findById(id).lean();
  const attempts = (delivery?.attempts || 0) + 1;
  const delay = RETRY_DELAYS_MS.at(attempts - 1);
  const retrying = delay !== undefined;
  return await NotificationDeliveryModel.findByIdAndUpdate(
    id,
    {
      $set: {
        status: retrying ? "pending" : "failed",
        attempts,
        response_code,
        error,
        next_retry_at: retrying ? new Date(Date.now() + delay) : null
      }
    },
    { new: true }
  ).lean();
}

// Ends a delivery without retrying (e.g. its channel was deleted or disabled).
async function markFailed(id, error) {
  return await NotificationDeliveryModel.findByIdAndUpdate(id, { $set: { status: "failed", error, next_retry_at: null } }, { new: true }).lean();
}

// Claims one due delivery so that parallel workers never send the same row twice.
async function claimDueDelivery() {
  return await NotificationDeliveryModel.findOneAndUpdate(
    { status: "pending", next_retry_at: { $lte: new Date() } },
    { $set: { status: "sending" } },
    { sort: { next_retry_at: 1 }, new: true }
  ).lean();
}

// Rows stuck in "sending" (worker crashed mid-send) go back to the queue.
async function releaseStaleClaims(olderThanMs = 600_000) {
  await NotificationDeliveryModel.updateMany(
    { status: "sending", updatedAt: { $lt: new Date(Date.now() - olderThanMs) } },
    { $set: { status: "pending", next_retry_at: new Date() } }
  );
}

async function listDeliveries({ org_id, channel_id, rule_id, status, from, to, page = 1, limit = 50 }) {
  const query = { org_id, internal: { $ne: true } };
  if (channel_id) query.channel_id = channel_id;
  if (rule_id) query.rule_id = rule_id;
  if (status) query.status = status;
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    if (to) query.createdAt.$lte = new Date(to);
  }
  const [data, total] = await Promise.all([
    NotificationDeliveryModel.find(query, { payload: 0 })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    NotificationDeliveryModel.countDocuments(query)
  ]);
  return { data, total, page, limit };
}

// Manual retry: only failed or pending rows, scoped to the org.
async function requeueDelivery(org_id, id) {
  return await NotificationDeliveryModel.findOneAndUpdate(
    { _id: id, org_id, internal: { $ne: true }, status: { $in: ["failed", "pending"] } },
    { $set: { status: "pending", next_retry_at: new Date() } },
    { new: true }
  ).lean();
}

export default {
  createDelivery,
  markSent,
  markAttemptFailed,
  markFailed,
  claimDueDelivery,
  releaseStaleClaims,
  listDeliveries,
  requeueDelivery,
  RETRY_DELAYS_MS
};
