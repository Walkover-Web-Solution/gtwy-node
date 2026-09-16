import OrgBillingModel from "../mongoModel/OrgBilling.model.js";

// All Mongo access for org_billings lives here.

const getByOrg = async (org_id) => OrgBillingModel.findOne({ org_id: String(org_id) }).lean();

// Create-or-update; the org_id is the identity and is never changed.
const upsert = async (org_id, fields) =>
  OrgBillingModel.findOneAndUpdate(
    { org_id: String(org_id) },
    { $set: fields, $setOnInsert: { org_id: String(org_id) } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

// Conditional transition: apply `fields` only while the row is in one of
// `fromStatuses`. Returns the updated row, or null when the guard did not match
// (someone else moved it first). Atomic, so two webhooks racing on the same org
// cannot both, say, start a grace period.
const setStatusIf = async (org_id, fromStatuses, fields) =>
  OrgBillingModel.findOneAndUpdate({ org_id: String(org_id), status: { $in: fromStatuses } }, { $set: fields }, { new: true }).lean();

const listByStatus = async (statuses) => OrgBillingModel.find({ status: { $in: statuses } }).lean();

// Rows whose grace period has run out.
const listGraceExpired = async (now = new Date()) => OrgBillingModel.find({ status: "past_due", grace_until: { $ne: null, $lte: now } }).lean();

const incrementRetry = async (org_id) =>
  OrgBillingModel.updateOne({ org_id: String(org_id) }, { $inc: { retry_count: 1 }, $set: { last_retry_at: new Date() } });

export default { getByOrg, upsert, setStatusIf, listByStatus, listGraceExpired, incrementRetry };
